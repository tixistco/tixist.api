import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUserService } from './auth-user.service';
import { AuthUser, Tokens } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { HashingService } from './hashing.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hashing: HashingService,
    private readonly authUser: AuthUserService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const password = await this.hashing.hash(dto.password);
    return this.prisma.user.create({
      data: { email: dto.email, password, name: dto.name },
      select: { id: true, email: true, name: true },
    });
  }

  async login(dto: LoginDto): Promise<{ tokens: Tokens; user: AuthUser }> {
    const user = await this.validateUser(dto.email, dto.password);
    const tokens = await this.issueTokens(user.id);
    return { tokens, user };
  }

  async refresh(userId: string, presentedToken: string): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.hashedRefreshToken) throw new UnauthorizedException();
    if (user.hashedRefreshToken !== this.digest(presentedToken)) {
      throw new UnauthorizedException();
    }
    const tokens = await this.issueTokens(userId);
    await this.authUser.evict(userId);
    return tokens;
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: null },
    });
    await this.authUser.evict(userId);
  }

  private async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.password) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.hashing.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return { id: user.id, email: user.email, name: user.name };
  }

  private async issueTokens(userId: string): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: (this.config.get<string>('JWT_ACCESS_TTL') ??
          '15m') as JwtSignOptions['expiresIn'],
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti: randomUUID() },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_TTL') ??
          '7d') as JwtSignOptions['expiresIn'],
      },
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: this.digest(refreshToken) },
    });
    return { accessToken, refreshToken };
  }

  /** High-entropy token digest (SHA-256 — not bcrypt, whose 72-byte cap truncates JWTs). */
  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
