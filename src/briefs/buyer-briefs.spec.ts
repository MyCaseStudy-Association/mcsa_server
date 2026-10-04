import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma/prisma.service';
import type { QaService } from '../sale/qa.service';
import { BriefsService } from './briefs.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { RegisterDto } from '../auth/dto/register.dto';

const input = {
  spec: {
    domains: ['coding'],
    languages: ['en'],
    keywordsAny: ['python'],
    keywordsAll: [],
    keywordsNone: [],
    minPromptsPerConversation: 2,
  },
  quality: { maxRedactionDensity: 0.15, dedupGuarantee: 'exact+near' },
  volume: { targetConversations: 100, maxPerContributor: null },
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
describe('buyer brief validation and ownership', () => {
  it('accepts structured brief uploads and rejects client-supplied ownership/escrow', async () => {
    expect(
      await validate(plainToInstance(CreateBriefDto, input), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(CreateBriefDto, {
            ...input,
            buyerRef: 'other',
            escrowCommitted: true,
          }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects nested invalid brief data', async () => {
    const errors = await validate(
      plainToInstance(CreateBriefDto, {
        ...input,
        spec: { ...input.spec, domains: ['unknown'] },
        volume: { targetConversations: -1 },
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
  it('normal signup cannot choose a privileged role', async () => {
    expect(
      (
        await validate(
          plainToInstance(RegisterDto, {
            email: 'user@example.com',
            password: 'TestPassword123!',
            role: 'admin',
          }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('scopes buyer list to authenticated owner', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new BriefsService(
      {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'buyer' }) },
        brief: { findMany },
      } as unknown as PrismaService,
      {} as QaService,
    );
    await service.listForAccount('owner');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buyer: { userId: 'owner' } } }),
    );
  });
  it('contributors cannot list briefs', async () => {
    const service = new BriefsService(
      {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'user' }) },
      } as unknown as PrismaService,
      {} as QaService,
    );
    await expect(service.listForAccount('contributor')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('moderators cannot activate an unfunded brief', async () => {
    const update = jest.fn();
    const service = new BriefsService(
      {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'admin' }) },
        brief: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'draft',
            escrowCommitted: false,
            expiresAt: new Date(Date.now() + 86400000),
          }),
          update,
        },
      } as unknown as PrismaService,
      {} as QaService,
    );
    await expect(
      service.moderateForAccount('admin', 'brief_test', 'live'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});
