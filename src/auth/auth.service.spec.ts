import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function setup() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as any;
  const jwt = { signAsync: jest.fn() } as any;
  const hashing = { hash: jest.fn(), compare: jest.fn() } as any;
  const authUser = { evict: jest.fn() } as any;
  const config = {
    get: jest.fn(
      (k: string) =>
        ({
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL: '7d',
        })[k],
    ),
  } as any;
  const service = new AuthService(prisma, jwt, hashing, authUser, config);
  return { service, prisma, jwt, hashing, authUser };
}

describe('AuthService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
    c.jwt.signAsync
      .mockResolvedValueOnce('access.jwt')
      .mockResolvedValueOnce('refresh.jwt');
  });

  describe('register', () => {
    it('hashes the password and creates the user', async () => {
      c.prisma.user.findUnique.mockResolvedValue(null);
      c.hashing.hash.mockResolvedValue('hashed-pw');
      c.prisma.user.create.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Ada',
      });

      const user = await c.service.register({
        email: 'a@b.com',
        password: 'pw123456',
        name: 'Ada',
      });

      expect(c.hashing.hash).toHaveBeenCalledWith('pw123456');
      expect(c.prisma.user.create).toHaveBeenCalled();
      expect(user).toEqual({ id: 'u1', email: 'a@b.com', name: 'Ada' });
    });

    it('rejects a duplicate email', async () => {
      c.prisma.user.findUnique.mockResolvedValue({ id: 'exists' });
      await expect(
        c.service.register({ email: 'a@b.com', password: 'pw123456' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('returns tokens + user and stores the refresh digest', async () => {
      c.prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Ada',
        password: 'hashed-pw',
      });
      c.hashing.compare.mockResolvedValue(true);

      const result = await c.service.login({
        email: 'a@b.com',
        password: 'pw123456',
      });

      expect(result.tokens).toEqual({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });
      expect(result.user).toEqual({ id: 'u1', email: 'a@b.com', name: 'Ada' });
      expect(c.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { hashedRefreshToken: sha256('refresh.jwt') },
      });
    });

    it('rejects bad credentials', async () => {
      c.prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        password: 'hashed-pw',
      });
      c.hashing.compare.mockResolvedValue(false);

      await expect(
        c.service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates tokens when the presented token matches the stored digest', async () => {
      c.prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        hashedRefreshToken: sha256('old.refresh'),
      });

      const tokens = await c.service.refresh('u1', 'old.refresh');

      expect(tokens).toEqual({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });
      expect(c.authUser.evict).toHaveBeenCalledWith('u1');
    });

    it('rejects a token that does not match the stored digest', async () => {
      c.prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        hashedRefreshToken: sha256('the.real.one'),
      });

      await expect(c.service.refresh('u1', 'forged')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('clears the stored refresh digest and evicts the cache', async () => {
      await c.service.logout('u1');

      expect(c.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { hashedRefreshToken: null },
      });
      expect(c.authUser.evict).toHaveBeenCalledWith('u1');
    });
  });
});
