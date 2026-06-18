import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import type { AuthUser, Tokens } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto): Promise<{ user: AuthUser }> {
    return { user: await this.auth.register(dto) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto): Promise<Tokens & { user: AuthUser }> {
    const { tokens, user } = await this.auth.login(dto);
    return { ...tokens, user };
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @CurrentUser() user: { sub: string; refreshToken: string },
  ): Promise<Tokens> {
    return this.auth.refresh(user.sub, user.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.id);
  }
}
