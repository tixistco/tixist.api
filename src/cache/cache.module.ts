import KeyvRedis from '@keyv/redis';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Keyv } from 'keyv';

/** Global cache prefix — every key is namespaced under `tix-ist:`. */
export const CACHE_NAMESPACE = 'tix-ist';

@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttlSeconds = config.get<number>('AUTH_CACHE_TTL') ?? 60;
        const keyv = new Keyv({
          store: new KeyvRedis(config.get<string>('REDIS_URL')),
          namespace: CACHE_NAMESPACE,
        });
        return { stores: [keyv], ttl: ttlSeconds * 1000 };
      },
    }),
  ],
})
export class CacheModule {}
