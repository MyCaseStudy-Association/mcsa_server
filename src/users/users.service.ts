import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserWithPassword } from './user.entity';

interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await hash(input.password, 12);
    const email = input.email.trim().toLowerCase();
    const name = input.name?.trim() || null;

    try {
      const user = await this.prismaService.user.create({
        data: {
          name,
          email,
          passwordHash,
        },
      });

      return this.toUser(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  async findByEmailWithPassword(
    email: string,
  ): Promise<UserWithPassword | null> {
    const user = await this.prismaService.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    return user ? this.toUserWithPassword(user) : null;
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prismaService.user.findUnique({
      where: { id },
    });

    return user ? this.toUser(user) : null;
  }

  private toUser(user: Prisma.UserGetPayload<object>): User {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private toUserWithPassword(
    user: Prisma.UserGetPayload<object>,
  ): UserWithPassword {
    return {
      ...this.toUser(user),
      passwordHash: user.passwordHash,
    };
  }

  private isUniqueViolation(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
