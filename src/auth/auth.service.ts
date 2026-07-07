import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthResponse, TokenPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      'local-access-secret';
    this.refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ??
      'local-refresh-secret';
    this.accessTtlSeconds = this.readTtlSeconds('JWT_ACCESS_EXPIRES_IN', '15m');
    this.refreshTtlSeconds = this.readTtlSeconds(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const user = await this.usersService.create(registerDto);
    return this.issueTokens(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    if (!user || !(await compare(loginDto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user);
  }

  async refresh(refreshTokenDto: RefreshTokenDto): Promise<AuthResponse> {
    const payload = await this.verifyRefreshToken(refreshTokenDto.refreshToken);
    const activeToken = await this.getActiveRefreshToken(
      payload,
      refreshTokenDto.refreshToken,
    );
    const user = await this.usersService.findById(activeToken.userId);

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.revokeRefreshToken(activeToken.id);
    return this.issueTokens(user);
  }

  async logout(logoutDto: LogoutDto): Promise<{ message: string }> {
    const payload = await this.verifyRefreshToken(logoutDto.refreshToken);
    const activeToken = await this.getActiveRefreshToken(
      payload,
      logoutDto.refreshToken,
    );

    await this.revokeRefreshToken(activeToken.id);
    return { message: 'Logged out' };
  }

  async me(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    return user;
  }

  private async issueTokens(user: User): Promise<AuthResponse> {
    const refreshTokenId = randomUUID();
    const accessPayload: TokenPayload = {
      sub: user.id,
      email: user.email,
      type: 'access',
    };
    const refreshPayload: TokenPayload = {
      sub: user.id,
      email: user.email,
      type: 'refresh',
      jti: refreshTokenId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: this.accessTtlSeconds,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtlSeconds,
      }),
    ]);

    await this.prismaService.refreshToken.create({
      data: {
        id: refreshTokenId,
        userId: user.id,
        tokenHash: await hash(refreshToken, 12),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
      },
    });

    return {
      user,
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
      refreshExpiresIn: this.refreshTtlSeconds,
    };
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<TokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(
        refreshToken,
        {
          secret: this.refreshSecret,
        },
      );

      if (payload.type !== 'refresh' || !payload.jti) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async getActiveRefreshToken(
    payload: TokenPayload,
    refreshToken: string,
  ): Promise<Prisma.RefreshTokenGetPayload<object>> {
    const token = await this.prismaService.refreshToken.findFirst({
      where: {
        id: payload.jti,
        userId: payload.sub,
      },
    });

    if (
      !token ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      !(await compare(refreshToken, token.tokenHash))
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return token;
  }

  private async revokeRefreshToken(id: string): Promise<void> {
    await this.prismaService.refreshToken.updateMany({
      where: {
        id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private readTtlSeconds(name: string, fallback: string): number {
    return parseDurationToSeconds(
      this.configService.get<string>(name) ?? fallback,
    );
  }
}

function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  const numericValue = Number(trimmed);

  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  const match = /^(\d+)\s*([smhd])$/i.exec(trimmed);

  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * multipliers[unit];
}
