/**
 * Stage 8 — Build #7: the QA step of the sale pipeline (§7.1, APP-D-17).
 *
 *   brief match (device) → Stage 6 + packaging → QA (here) → QA_PASSED
 *   → fulfilment selection (§7.2, not built yet)
 *
 * Runs per (brief, conversation) pair. Both orderings converge: Stage 6 runs
 * QA for matches already reported, and a match report runs QA for a
 * conversation already packaged. Whichever arrives second produces the
 * result. Re-running is idempotent (one row per BriefMatch) and stops once
 * the bundle is sold, because a sale is final (D-18).
 *
 * Inputs are all server-held: the packaged bundle's de-identified prompts
 * and device-supplied tags/language (Crossing (1) metadata), the signed
 * consent receipt, and stored fingerprints. Nothing here reads raw content,
 * and nothing it writes or logs holds text (INV-1).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { BriefQuality, BriefSpec } from '../briefs/briefs.types';
import type { ConsentReceiptPayload } from '../refinement/packaging/consent-receipt';
import { preciseValue } from '../valuation/precise-valuation';
import {
  classifyDuplicates,
  DEDUP_VERSION,
  DedupStatus,
  SeenFingerprint,
} from './dedup';
import { QA_GATE_VERSION, qaGate } from './qa-gate';
import type { QaCandidate } from './qa-gate';
import type { QaRunSummary } from './sale.types';

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runForConversation(
    userId: string,
    internalConversationRef: string,
    now: Date = new Date(),
  ): Promise<QaRunSummary> {
    const summary: QaRunSummary = { evaluated: 0, passed: 0 };

    const matches = await this.prisma.briefMatch.findMany({
      where: { userId, internalConversationRef },
      include: {
        brief: { include: { buyer: { select: { categoryId: true } } } },
      },
    });
    if (matches.length === 0) return summary;

    const record = await this.prisma.packagedRecord.findUnique({
      where: {
        userId_internalConversationRef: { userId, internalConversationRef },
      },
    });
    if (record?.status === 'sold') return summary; // final (D-18)

    const receipt = record
      ? await this.prisma.consentReceipt.findUnique({
          where: { receiptRef: record.consentReceiptRef },
        })
      : null;
    const receiptPayload = receipt?.payload as
      ConsentReceiptPayload | undefined;
    const keptFingerprints =
      receiptPayload?.scope.conversation_fingerprints ?? [];

    const wantsNear = matches.some(
      (match) =>
        (match.brief.quality as BriefQuality).dedupGuarantee === 'exact+near',
    );
    const dedupStatus = await this.dedupStatus(
      userId,
      keptFingerprints,
      wantsNear,
    );

    const finalPrompts =
      record && record.status === 'available'
        ? (record.prompts as string[])
        : [];
    const candidate: QaCandidate = {
      finalPrompts,
      language: record?.language ?? 'und',
      domainTags: (record?.domainTags as string[] | undefined) ?? [],
      dedupStatus,
      consent: {
        present: receiptPayload !== undefined,
        revoked: receipt?.revokedAt != null,
        buyerCategories: receiptPayload?.authorisation.buyer_categories ?? [],
        jurisdiction: receiptPayload?.jurisdiction ?? null,
      },
    };

    for (const match of matches) {
      const { brief } = match;
      const result = qaGate(candidate, {
        live:
          brief.status === 'live' &&
          brief.escrowCommitted &&
          brief.expiresAt.getTime() > now.getTime(),
        categoryId: brief.buyer.categoryId,
        spec: brief.spec as BriefSpec,
        quality: brief.quality as BriefQuality,
      });
      // Precise valuation runs ONCE, only for a pass (Build #6 §6.3).
      const valuation = result.pass ? preciseValue(finalPrompts) : null;

      const data = {
        briefId: brief.id,
        userId,
        internalConversationRef,
        packagedRecordRef: record?.recordRef ?? null,
        packagedChainHash: record?.chainHash ?? null,
        status: result.pass ? 'passed' : 'failed',
        failures: result.failures,
        language: candidate.language,
        redactionDensity: result.redactionDensity,
        dedupStatus,
        tierCounts: valuation ? valuation.tierCounts : Prisma.DbNull,
        amountCents: valuation?.amountCents ?? null,
        pricingScheduleVersion: valuation?.scheduleVersion ?? null,
        qaVersion: QA_GATE_VERSION,
        dedupVersion: DEDUP_VERSION,
        passedAt: result.pass ? now : null,
      };
      await this.prisma.qaResult.upsert({
        where: { briefMatchId: match.id },
        create: { briefMatchId: match.id, ...data },
        update: data,
      });

      summary.evaluated += 1;
      if (result.pass) summary.passed += 1;
      // Metadata only (NFR-7): refs and failure codes, never text.
      this.logger.log(
        `qa brief=${brief.briefRef} user=${userId} pass=${result.pass} failures=${result.failures.join(',') || '-'} dedup=${dedupStatus}`,
      );
    }
    return summary;
  }

  /** Cross-contributor dedup on stored fingerprints (see dedup.ts). */
  private async dedupStatus(
    userId: string,
    keptFingerprints: string[],
    wantsNear: boolean,
  ): Promise<DedupStatus> {
    if (keptFingerprints.length === 0) return 'new';

    const ownRows = await this.prisma.recordFingerprint.findMany({
      where: { userId, exactHash: { in: keptFingerprints } },
      select: { exactHash: true, simHash: true, createdAt: true },
    });
    // Near-duplicates need every other contributor's SimHash: a full scan,
    // acceptable at Phase-0 volume. Replace with an indexed LSH lookup (or a
    // Postgres bit_count query) before volume grows.
    const otherRows = await this.prisma.recordFingerprint.findMany({
      where: wantsNear
        ? { userId: { not: userId } }
        : { userId: { not: userId }, exactHash: { in: keptFingerprints } },
      select: { exactHash: true, simHash: true, createdAt: true },
    });

    const seen = (row: {
      exactHash: string;
      simHash: string;
      createdAt: Date;
    }): SeenFingerprint => ({
      exactHash: row.exactHash,
      simHash: row.simHash,
      seenAt: row.createdAt,
    });
    return classifyDuplicates(ownRows.map(seen), otherRows.map(seen));
  }
}
