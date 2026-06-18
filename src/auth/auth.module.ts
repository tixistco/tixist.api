import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthUserService } from './auth-user.service';
import { HashingService } from './hashing.service';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthUserService,
    HashingService,
    JwtStrategy,
    JwtRefreshStrategy,
    // Protect every route by default; @Public() opts out.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthUserService],
})
export class AuthModule {}
