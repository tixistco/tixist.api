import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Validates the refresh token (separate secret) on POST /auth/refresh. */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
