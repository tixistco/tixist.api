import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';

/**
 * Resolves the auth user for request authentication through a read-through cache,
 * so the hot path doesn't hit Postgres on every request. Fails open: any cache
 * error falls back to the database (logged at warn) rather than throwing.
 */
@Injectable()
export class AuthUserService {
  private readonly logger = new Logger(AuthUserService.name);
  private readonly ttlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs = (config.get<number>('AUTH_CACHE_TTL') ?? 60) * 1000;
  }

  private key(id: string): string {
    return `auth:user:${id}`;
  }

  async getById(id: string): Promise<AuthUser | null> {
    try {
      const cached = await this.cache.get<AuthUser>(this.key(id));
      if (cached) return cached;
    } catch (error) {
      this.logger.warn(`cache get failed for ${id}: ${String(error)}`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true },
    });
    if (!user) return null;

    try {
      await this.cache.set(this.key(id), user, this.ttlMs);
    } catch (error) {
      this.logger.warn(`cache set failed for ${id}: ${String(error)}`);
    }
    return user;
  }

  async evict(id: string): Promise<void> {
    try {
      await this.cache.del(this.key(id));
    } catch (error) {
      this.logger.warn(`cache del failed for ${id}: ${String(error)}`);
    }
  }
}
