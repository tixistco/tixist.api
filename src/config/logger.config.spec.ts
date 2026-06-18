import { ConfigService } from '@nestjs/config';
import { buildPinoOptions } from './logger.config';

const cfg = (over: Record<string, unknown> = {}): ConfigService =>
  new ConfigService({ NODE_ENV: 'development', PORT: 3000, ...over });

describe('buildPinoOptions', () => {
  it('uses the pino-pretty transport and debug level in development', () => {
    const opts = buildPinoOptions(cfg({ NODE_ENV: 'development' }));

    expect((opts.transport as { target?: string } | undefined)?.target).toBe(
      'pino-pretty',
    );
    expect(opts.level).toBe('debug');
  });

  it('disables the transport and defaults to info in production', () => {
    const opts = buildPinoOptions(cfg({ NODE_ENV: 'production' }));

    expect(opts.transport).toBeUndefined();
    expect(opts.level).toBe('info');
  });

  it('honors an explicit LOG_LEVEL over the default', () => {
    const opts = buildPinoOptions(
      cfg({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }),
    );

    expect(opts.level).toBe('warn');
  });

  it('redacts the authorization header', () => {
    const opts = buildPinoOptions(cfg());

    expect(opts.redact).toContain('req.headers.authorization');
  });

  it('reuses an incoming x-request-id and echoes it on the response', () => {
    const opts = buildPinoOptions(cfg());
    const req = { headers: { 'x-request-id': 'abc-123' } };
    const setHeader = jest.fn();
    const res = { setHeader };

    const genReqId = opts.genReqId as (req: unknown, res: unknown) => string;
    const id = genReqId(req, res);

    expect(id).toBe('abc-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
  });

  it('generates a request id when none is provided', () => {
    const opts = buildPinoOptions(cfg());
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };

    const genReqId = opts.genReqId as (req: unknown, res: unknown) => string;
    const id = genReqId(req, res);

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
