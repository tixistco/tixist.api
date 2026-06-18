import { describe, expect, it } from '@jest/globals';
import { validate } from './env.validation';

const DB = 'postgresql://user:pass@localhost:5432/tixist?schema=public';

// All currently-required vars; spread into each case and override as needed.
const base = {
  DATABASE_URL: DB,
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  REDIS_URL: 'redis://localhost:6379',
};

describe('validate (env)', () => {
  it('accepts a valid env and coerces PORT to a number', () => {
    const result = validate({
      ...base,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'info',
    });

    expect(result.NODE_ENV).toBe('production');
    expect(result.PORT).toBe(8080);
    expect(typeof result.PORT).toBe('number');
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.DATABASE_URL).toBe(DB);
  });

  it('applies defaults when optional vars are missing', () => {
    const result = validate(base);

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.JWT_ACCESS_TTL).toBe('15m');
    expect(result.JWT_REFRESH_TTL).toBe('7d');
    expect(result.AUTH_CACHE_TTL).toBe(60);
  });

  it('throws on an invalid LOG_LEVEL', () => {
    expect(() => validate({ ...base, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('throws on a non-numeric PORT', () => {
    expect(() => validate({ ...base, PORT: 'not-a-number' })).toThrow();
  });

  it('throws on an out-of-range PORT', () => {
    expect(() => validate({ ...base, PORT: '70000' })).toThrow();
  });

  it('throws on an invalid NODE_ENV', () => {
    expect(() => validate({ ...base, NODE_ENV: 'staging' })).toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => validate(rest)).toThrow();
  });

  it('throws when DATABASE_URL is not a postgres url', () => {
    expect(() => validate({ ...base, DATABASE_URL: 'mysql://nope' })).toThrow();
  });

  it('throws when a JWT secret is too short', () => {
    expect(() => validate({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow();
  });

  it('throws when REDIS_URL is not a redis url', () => {
    expect(() =>
      validate({ ...base, REDIS_URL: 'http://localhost' }),
    ).toThrow();
  });
});
