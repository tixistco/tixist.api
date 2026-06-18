import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

import { Environment, LogLevel } from './env.validation';

/**
 * Builds the `pinoHttp` options for nestjs-pino from validated config.
 * Pure function (no NestJS context) so it can be unit-tested in isolation.
 *
 * - dev: human-friendly `pino-pretty` output; prod: raw single-line JSON
 * - request correlation via `x-request-id` (reused if present, else generated)
 * - sensitive headers redacted
 */
export function buildPinoOptions(config: ConfigService): Options {
  const isProduction =
    config.get<Environment>('NODE_ENV') === Environment.Production;
  const level =
    config.get<LogLevel>('LOG_LEVEL') ??
    (isProduction ? LogLevel.Info : LogLevel.Debug);

  return {
    level,
    transport: isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            colorize: true,
            translateTime: 'SYS:standard',
          },
        },
    genReqId: (req: IncomingMessage, res: ServerResponse): string => {
      const incoming = req.headers['x-request-id'];
      const id =
        (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    customProps: () => ({ context: 'HTTP' }),
    autoLogging: true,
  };
}
