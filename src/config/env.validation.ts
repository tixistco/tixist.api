import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsEnum(LogLevel)
  LOG_LEVEL?: LogLevel;

  // Composed from the DB_* parts via dotenv variable expansion (see .env.example).
  // Validated here as the effective connection string Prisma will use.
  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgres(ql):// connection string',
  })
  DATABASE_URL!: string;

  // --- Auth (JWT) ---
  @IsString()
  @MinLength(16)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(16)
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsOptional()
  @IsString()
  JWT_REFRESH_TTL: string = '7d';

  // --- Cache (Redis) ---
  @Matches(/^rediss?:\/\/.+/, {
    message: 'REDIS_URL must be a redis(s):// connection string',
  })
  REDIS_URL!: string;

  // Seconds an auth user stays cached before re-reading from the DB.
  @IsOptional()
  @IsInt()
  @Min(1)
  AUTH_CACHE_TTL: number = 60;
}

/**
 * Validates raw environment variables against {@link EnvironmentVariables} and
 * returns a typed, coerced object. Throws (failing app boot) on any violation.
 * Wired into `ConfigModule.forRoot({ validate })`.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.toString()).join('\n'));
  }

  return validated;
}
