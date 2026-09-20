/**
 * Stage 8 — Build #5: briefs. The full brief is server-only (INV-8); the
 * device sees `toDevicePayload` and nothing else. Brief/buyer creation has
 * NO contributor-facing endpoint — the Phase-0 seed (prisma/seed.ts) and,
 * later, the admin console (§7.9) call this service directly.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Device-facing (JwtAuthGuard in the controller)
  // -------------------------------------------------------------------------

  /** The minimal matching payload for every live, escrow-committed brief. */
  async pushPayload(now: Date = new Date()): Promise<DevicePushPayload> {
    const rows = await this.prisma.brief.findMany({
      where: { status: 'live', escrowCommitted: true, expiresAt: { gt: now } },
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
   * hold (live + committed) accept reports.
   */
  async reportMatches(
    userId: string,
    dto: ReportMatchesDto,
  ): Promise<{ briefRef: string; recorded: number }> {
    const brief = await this.prisma.brief.findUnique({
      where: { briefRef: dto.briefRef },
      select: { id: true, status: true, escrowCommitted: true },
    });
    if (!brief || brief.status !== 'live' || !brief.escrowCommitted) {
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
    await this.prisma.brief.update({
      where: { briefRef },
      data: { status: 'live' },
    });
  }
}
