import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';

describe('shared account authorization', () => {
  it.each(['buyer', 'admin'])(
    'rejects %s mobile login before issuing tokens',
    async (role) => {
      const users = {
        findByEmailWithPassword: jest.fn().mockResolvedValue({
          id: 'test',
          role,
          email: 'test@example.com',
          passwordHash: await hash('TestPassword123!', 4),
        }),
      };
      const signAsync = jest.fn();
      const service = new AuthService(
        users as unknown as UsersService,
        {} as PrismaService,
        { signAsync } as unknown as JwtService,
        new ConfigService(),
      );
      await expect(
        service.login({
          email: 'test@example.com',
          password: 'TestPassword123!',
          client: 'mobile',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(signAsync).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['user', ['buyer', 'admin'], false],
    ['buyer', ['user'], false],
    ['buyer', ['admin'], false],
    ['admin', ['admin'], true],
    ['buyer', ['buyer', 'admin'], true],
    ['user', ['user'], true],
  ])('checks signed role %s against %j', async (role, allowed, accepted) => {
    const request = { headers: { authorization: 'Bearer test' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => null,
      getClass: () => null,
    } as unknown as ExecutionContext;
    const guard = new JwtAuthGuard(
      {
        verifyAsync: jest
          .fn()
          .mockResolvedValue({ sub: 'test', role, type: 'access' }),
      } as unknown as JwtService,
      new ConfigService(),
      { getAllAndOverride: () => allowed } as unknown as Reflector,
    );
    if (accepted) await expect(guard.canActivate(context)).resolves.toBe(true);
    else
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
  });
});
