import type { Prisma } from '@prisma/client';
import { CreateBriefDto } from './dto/create-brief.dto';
import { PRICING_SCHEDULE_VERSION } from '../valuation/pricing-schedule';
/**
 * Stage 8 — Build #5: briefs. The full brief is server-only (INV-8); the
 * device sees `toDevicePayload` and nothing else. Brief/buyer creation has
 * NO contributor-facing endpoint — the Phase-0 seed (prisma/seed.ts) and,
 * later, the admin console (§7.9) call this service directly.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QaService } from '../sale/qa.service';
import type {
  BriefQuality,
  BriefSpec,
  BriefVolume,
  DevicePushPayload,
  PushableBrief,
} from './briefs.types';
import { ReportMatchesDto } from './dto/report-matches.dto';
import { toDevicePayload } from './push-payload';
import {
  BUYER_CATEGORY_TAXONOMY_VERSION,
  BuyerCategoryId,
  isBuyerCategoryId,
} from './taxonomy';

export type CreateBuyerInput = {
  legalName: string;
  categoryId: BuyerCategoryId;
};

export type CreateBriefInput = {
  buyerRef: string;
  spec: BriefSpec;
  quality: BriefQuality;
  volume: BriefVolume;
  pricingScheduleVersion: string;
  expiresAt: Date;
};

const ref = (prefix: string) =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

@Injectable()
export class BriefsService {
  private readonly logger = new Logger(BriefsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qa: QaService,
  ) {}

  async listForAccount(userId: string): Promise<
    Prisma.BriefGetPayload<{
      include: {
        buyer: { select: { legalName: true; categoryId: true } };
        _count: { select: { matches: true } };
        payment: {
          select: { status: true; amountCents: true; currency: true };
        };
      };
    }>[]
  > {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!account || !['buyer', 'admin'].includes(account.role))
      throw new ForbiddenException();
    return this.prisma.brief.findMany({
      where: account.role === 'admin' ? {} : { buyer: { userId } },
      include: {
        buyer: { select: { legalName: true, categoryId: true } },
        _count: { select: { matches: true } },
        payment: {
          select: { status: true, amountCents: true, currency: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createForAccount(
    userId: string,
    dto: CreateBriefDto,
  ): Promise<{ briefRef: string }> {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!buyer || buyer.user?.role !== 'buyer')
      throw new ForbiddenException('Buyer account required.');
    if (new Date(dto.expiresAt) <= new Date())
      throw new BadRequestException('Expiry must be in the future.');
    if (!dto.spec.domains.length || !dto.spec.languages.length)
      throw new BadRequestException('Choose at least one domain and language.');
    return this.createBrief({
      buyerRef: buyer.buyerRef,
      spec: { ...dto.spec },
      quality: { ...dto.quality },
      volume: {
        ...dto.volume,
        maxPerContributor: dto.volume.maxPerContributor ?? null,
      },
      pricingScheduleVersion: PRICING_SCHEDULE_VERSION,
      expiresAt: new Date(dto.expiresAt),
    });
  }

  async moderateForAccount(
    userId: string,
    briefRef: string,
    status: 'live' | 'paused',
  ): Promise<{ briefRef: string; status: string }> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (account?.role !== 'admin') throw new ForbiddenException();
    const brief = await this.prisma.brief.findUnique({ where: { briefRef } });
    if (!brief) throw new NotFoundException('Brief not found.');
    if (['filled', 'expired'].includes(brief.status))
      throw new BadRequestException('This brief is closed.');
    if (status === 'live') {
      if (brief.expiresAt <= new Date())
        throw new BadRequestException('Brief has expired.');
      await this.goLive(briefRef);
    } else
      await this.prisma.brief.update({ where: { briefRef }, data: { status } });
    return { briefRef, status };
  }

  // -------------------------------------------------------------------------
  // Device-facing (JwtAuthGuard in the controller)
  // -------------------------------------------------------------------------

  /** The minimal matching payload for every live, escrow-committed brief. */
  async pushPayload(now: Date = new Date()): Promise<DevicePushPayload> {
    const rows = await this.prisma.brief.findMany({
      where: {
        status: 'live',
        escrowCommitted: true,
        expiresAt: { gt: now },
        payment: { is: { status: 'paid', paymentIntentId: { not: null } } },
      },
      include: { buyer: { select: { categoryId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return toDevicePayload(
      rows.map((row): PushableBrief => ({
        briefRef: row.briefRef,
        status: row.status,
        escrowCommitted: row.escrowCommitted,
        expiresAt: row.expiresAt,
        spec: row.spec as BriefSpec,
        quality: row.quality as BriefQuality,
        buyer: row.buyer,
      })),
      now,
    );
  }

  /**
   * Records match metadata reported by the device (upsert per brief +
   * contributor + conversation). Only briefs the device could legitimately
   * hold (live + committed) accept reports. Each reported conversation then
   * goes through the QA gate (Build #7) if it is already packaged. QA
   * results never go back to the device (§7.5: nothing is "rejected").
   */
  async reportMatches(
    userId: string,
    dto: ReportMatchesDto,
  ): Promise<{ briefRef: string; recorded: number }> {
    const brief = await this.prisma.brief.findUnique({
      where: { briefRef: dto.briefRef },
      select: {
        id: true,
        status: true,
        escrowCommitted: true,
        expiresAt: true,
        payment: { select: { status: true, paymentIntentId: true } },
      },
    });
    if (
      !brief ||
      brief.status !== 'live' ||
      !brief.escrowCommitted ||
      brief.payment?.status !== 'paid' ||
      !brief.payment.paymentIntentId ||
      brief.expiresAt <= new Date()
    ) {
      throw new NotFoundException('Brief not found.');
    }

    await this.prisma.$transaction(
      dto.conversations.map((conversation) =>
        this.prisma.briefMatch.upsert({
          where: {
            briefId_userId_internalConversationRef: {
              briefId: brief.id,
              userId,
              internalConversationRef: conversation.conversationId,
            },
          },
          create: {
            briefId: brief.id,
            userId,
            internalConversationRef: conversation.conversationId,
            promptCount: conversation.promptCount,
            fingerprints: conversation.fingerprints,
          },
          update: {
            promptCount: conversation.promptCount,
            fingerprints: conversation.fingerprints,
          },
        }),
      ),
    );

    for (const conversation of dto.conversations) {
      try {
        await this.qa.runForConversation(userId, conversation.conversationId);
      } catch (error) {
        // The match is recorded; QA re-runs on the next Stage 6 pass.
        this.logger.warn(`qa deferred (${(error as Error).name})`);
      }
    }
    return { briefRef: dto.briefRef, recorded: dto.conversations.length };
  }

  // -------------------------------------------------------------------------
  // Operator-side (seed / admin console) — no HTTP exposure in Build #5
  // -------------------------------------------------------------------------

  async createBuyer(input: CreateBuyerInput): Promise<{ buyerRef: string }> {
    if (!isBuyerCategoryId(input.categoryId)) {
      throw new BadRequestException('Unknown buyer category.');
    }
    const buyerRef = ref('buyer');
    await this.prisma.buyer.create({
      data: {
        buyerRef,
        legalName: input.legalName,
        categoryId: input.categoryId,
        categoryTaxonomyVersion: BUYER_CATEGORY_TAXONOMY_VERSION,
      },
    });
    return { buyerRef };
  }

  async createBrief(input: CreateBriefInput): Promise<{ briefRef: string }> {
    const buyer = await this.prisma.buyer.findUnique({
      where: { buyerRef: input.buyerRef },
      select: { id: true },
    });
    if (!buyer) throw new NotFoundException('Buyer not found.');
    const briefRef = ref('brief');
    await this.prisma.brief.create({
      data: {
        briefRef,
        buyerId: buyer.id,
        spec: input.spec,
        quality: input.quality,
        volume: input.volume,
        pricingScheduleVersion: input.pricingScheduleVersion,
        expiresAt: input.expiresAt,
      },
    });
    return { briefRef };
  }

  /** Escrow is committed BEFORE a brief goes live (D-16). Stripe in Phase 1; a sandbox ref in Phase 0. */
  async commitEscrow(briefRef: string, providerRef: string): Promise<void> {
    await this.prisma.brief.update({
      where: { briefRef },
      data: { escrowCommitted: true, escrowProviderRef: providerRef },
    });
  }

  /** The D-16 gate: a brief cannot be `live` without committed escrow. */
  async goLive(briefRef: string): Promise<void> {
    const brief = await this.prisma.brief.findUnique({
      where: { briefRef },
      select: { escrowCommitted: true },
    });
    if (!brief) throw new NotFoundException('Brief not found.');
    if (!brief.escrowCommitted) {
      throw new BadRequestException(
        'Brief cannot go live: escrow not committed (D-16).',
      );
    }
    const updated = await this.prisma.brief.updateMany({
      where: {
        briefRef,
        escrowCommitted: true,
        expiresAt: { gt: new Date() },
        status: { in: ['draft', 'paused', 'live'] },
      },
      data: { status: 'live' },
    });
    if (!updated.count)
      throw new BadRequestException('Brief is no longer funded or has closed.');
  }
}
