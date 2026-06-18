import { validate } from './env.validation';

describe('validate (env)', () => {
  it('accepts a valid env and coerces PORT to a number', () => {
    const result = validate({
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'info',
    });

    expect(result.NODE_ENV).toBe('production');
    expect(result.PORT).toBe(8080);
    expect(typeof result.PORT).toBe('number');
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('applies defaults when optional vars are missing', () => {
    const result = validate({});

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
  });

  it('throws on an invalid LOG_LEVEL', () => {
    expect(() => validate({ LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('throws on a non-numeric PORT', () => {
    expect(() => validate({ PORT: 'not-a-number' })).toThrow();
  });

  it('throws on an out-of-range PORT', () => {
    expect(() => validate({ PORT: '70000' })).toThrow();
  });

  it('throws on an invalid NODE_ENV', () => {
    expect(() => validate({ NODE_ENV: 'staging' })).toThrow();
  });
});
