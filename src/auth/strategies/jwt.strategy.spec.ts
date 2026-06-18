import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const config = {
  getOrThrow: jest.fn().mockReturnValue('access-secret'),
} as any;

describe('JwtStrategy', () => {
  it('resolves the auth user from the (cached) AuthUserService', async () => {
    const authUser = {
      getById: jest
        .fn()
        .mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'Ada' }),
    } as any;
    const strategy = new JwtStrategy(config, authUser);

    const result = await strategy.validate({ sub: 'u1' });

    expect(authUser.getById).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'u1', email: 'a@b.com', name: 'Ada' });
  });

  it('throws when the user no longer exists', async () => {
    const authUser = { getById: jest.fn().mockResolvedValue(null) } as any;
    const strategy = new JwtStrategy(config, authUser);

    await expect(strategy.validate({ sub: 'gone' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
