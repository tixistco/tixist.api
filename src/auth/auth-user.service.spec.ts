import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { AuthUserService } from './auth-user.service';

const AUTH_USER = { id: 'u1', email: 'a@b.com', name: 'Ada' };

function setup() {
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any;
  const prisma = { user: { findUnique: jest.fn() } } as any;
  const config = { get: jest.fn().mockReturnValue(60) } as any;
  const service = new AuthUserService(cache, prisma, config);
  return { service, cache, prisma };
}

describe('AuthUserService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('returns the cached user without hitting the database', async () => {
    ctx.cache.get.mockResolvedValue(AUTH_USER);

    const result = await ctx.service.getById('u1');

    expect(result).toEqual(AUTH_USER);
    expect(ctx.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('reads from the database on a cache miss and populates the cache', async () => {
    ctx.cache.get.mockResolvedValue(undefined);
    ctx.prisma.user.findUnique.mockResolvedValue(AUTH_USER);

    const result = await ctx.service.getById('u1');

    expect(result).toEqual(AUTH_USER);
    expect(ctx.prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(ctx.cache.set).toHaveBeenCalledWith(
      'auth:user:u1',
      AUTH_USER,
      60_000,
    );
  });

  it('returns null when the user does not exist', async () => {
    ctx.cache.get.mockResolvedValue(undefined);
    ctx.prisma.user.findUnique.mockResolvedValue(null);

    await expect(ctx.service.getById('missing')).resolves.toBeNull();
  });

  it('evict() deletes the namespaced key', async () => {
    await ctx.service.evict('u1');
    expect(ctx.cache.del).toHaveBeenCalledWith('auth:user:u1');
  });

  it('fails open to the database when the cache errors', async () => {
    ctx.cache.get.mockRejectedValue(new Error('redis down'));
    ctx.prisma.user.findUnique.mockResolvedValue(AUTH_USER);

    const result = await ctx.service.getById('u1');

    expect(result).toEqual(AUTH_USER);
    expect(ctx.prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
