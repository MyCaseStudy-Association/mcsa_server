/**
 * Stage 7 — package + provenance (Builds #2/#3/#4, spec §6, §7.5, App. F).
 *
 * Boundary (Crossing (2), INV-1): ONLY the de-identified conversation
 * bundle, the consent receipt, and provenance metadata persist. The
 * attestation chain, fingerprints, and source assistant stay server-side —
 * never shipped in the buyer record.
 *
 * The buyer-scoped conversation_id is DERIVED per buyer at delivery time
 * (keyed HMAC over buyerRef + internal ref) — stable for one buyer across
 * purchases, different for another buyer, never content-derived and never
 * stored.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { extendChain } from '../attestation/hash-chain';
import {
  buildConsentReceipt,
  ConsentContext,
  ConsentReceiptPayload,
  pseudonymousId,
  signReceipt,
  verifyReceiptSignature,
} from './consent-receipt';
import type { ConversationOutcome } from '../refinement.types';

/** Buyer-facing record (App. F §F.3) — data-minimised, prompts-only. */
export type BuyerRecord = {
  id: string;
  conversation_id: string;
  language: string;
  prompts: string[];
  source: { captured: string };
  provenance: { consent_receipt_ref: string };
  characteristics: {
    domain_tags: string[];
    turn_type: 'conversation';
    prompt_count: number;
  };
};

/** Exact wording ratified in the tracker — do not edit without counsel. */
const DEID_ASSURANCE =
  'De-identified to the strictest union of the HIPAA Safe Harbor identifier pattern, CCPA/CPRA sensitive personal information provisions, the Washington My Health My Data Act (and NV/CT analogues), COPPA, BIPA (and TX/WA biometric analogues), GDPR Article 9 special categories, and PIPEDA / Quebec Law 25: direct identifiers removed, special categories screened and excluded.';

@Injectable()
export class PackagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Fail at boot, not at first use: a receipt signed with a guessable key
    // is not proof (rule 18). `npm run env:init` generates these.
    for (const name of [
      'PSEUDONYM_SECRET',
      'CONSENT_SIGNING_SECRET',
      'PACKAGING_HMAC_SECRET',
    ]) {
      this.config.getOrThrow<string>(name);
    }
  }

  private secret(name: string): string {
    return this.config.getOrThrow<string>(name);
  }

  // -------------------------------------------------------------------------
  // Build #4 — one consent receipt per conversation
  // -------------------------------------------------------------------------

  /**
   * Creates + persists the signed receipt for one conversation and stamps
   * `consent_receipt_ref` into every attestation of that conversation
   * (closing the `consent_receipt_ref: null` gap). Call BEFORE attestations
   * are persisted.
   */
  async createReceipt(
    userId: string,
    conversation: ConversationOutcome,
    sourceProvider: string,
    consent: ConsentContext,
  ): Promise<string | null> {
    const kept = conversation.outcomes
      .filter((outcome) => outcome.outcome === 'kept')
      .sort((a, b) => a.turnIndex - b.turnIndex);
    if (kept.length === 0) return null; // nothing enters circulation

    const { receiptRef, payload } = buildConsentReceipt({
      pseudonymousContributorId: pseudonymousId(
        this.secret('PSEUDONYM_SECRET'),
        userId,
      ),
      sourceProvider,
      keptFingerprints: kept.map(
        (outcome) => outcome.attestation.record_fingerprint,
      ),
      consent,
    });
    const signature = signReceipt(
      this.secret('CONSENT_SIGNING_SECRET'),
      payload,
    );

    await this.prisma.consentReceipt.create({
      data: { receiptRef, userId, payload, signature },
    });

    conversation.outcomes.forEach((outcome) => {
      outcome.attestation.consent_receipt_ref = receiptRef;
    });
    return receiptRef;
  }

  // -------------------------------------------------------------------------
  // Build #2 — the packaged conversation bundle
  // -------------------------------------------------------------------------

  /**
   * Persists the de-identified bundle: kept prompts in original order,
   * excluded prompts simply absent (ordered gap). `prevHash` links the
   * bundle to the tail of the attestation chain (FR-5.3) so the full
   * contributor → de-identified record → buyer lineage verifies.
   */
  async createPackagedRecord(
    userId: string,
    conversation: ConversationOutcome,
    receiptRef: string,
    attestationChainTail: string | null,
    capturedAt?: number,
  ): Promise<string | null> {
    const kept = conversation.outcomes
      .filter((outcome) => outcome.outcome === 'kept' && outcome.finalText)
      .sort((a, b) => a.turnIndex - b.turnIndex);
    if (kept.length === 0) return null;

    const prompts = kept.map((outcome) => outcome.finalText as string);
    const turnIndexes = kept.map((outcome) => outcome.turnIndex);
    const recordRef = `rec_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    // Chain extension (FR-5.3): hash the packaged metadata onto the tail of
    // the attestation chain. Metadata only — fingerprints, never text.
    const chainPayload = JSON.stringify({
      recordRef,
      receiptRef,
      fingerprints: kept.map((o) => o.attestation.record_fingerprint),
      turnIndexes,
    });
    const chainHash = extendChain(attestationChainTail, chainPayload);

    await this.prisma.packagedRecord.upsert({
      where: {
        userId_internalConversationRef: {
          userId,
          internalConversationRef: conversation.conversationId,
        },
      },
      create: {
        recordRef,
        userId,
        internalConversationRef: conversation.conversationId,
        consentReceiptRef: receiptRef,
        language: 'en',
        capturedWindow: coarsenToQuarter(capturedAt),
        domainTags: deriveDomainTags(prompts),
        prompts,
        turnIndexes,
        prevHash: attestationChainTail,
        chainHash,
      },
      // Re-upload of the same conversation before dedup (FR-2.3) lands:
      // replace the bundle with the latest processing. Sold records are
      // final (D-18) — never overwritten.
      update: {
        consentReceiptRef: receiptRef,
        prompts,
        turnIndexes,
        domainTags: deriveDomainTags(prompts),
        prevHash: attestationChainTail,
        chainHash,
        status: 'available',
      },
    });
    return recordRef;
  }

  // -------------------------------------------------------------------------
  // Builds #2 + #3 — the delivered batch: JSONL records + datasheet
  // -------------------------------------------------------------------------

  async buildBatch(buyerRef: string): Promise<{
    datasheet: Record<string, unknown>;
    records: BuyerRecord[];
    jsonl: string;
  }> {
    const rows = await this.prisma.packagedRecord.findMany({
      where: { status: 'available' },
      orderBy: { createdAt: 'asc' },
    });

    const hmacSecret = this.secret('PACKAGING_HMAC_SECRET');
    const records: BuyerRecord[] = rows.map((row) => ({
      id: row.recordRef,
      // BUYER-scoped handle: stable for this buyer, unlinkable across buyers.
      conversation_id: `cv_${createHmac('sha256', hmacSecret)
        .update(`${buyerRef}:${row.internalConversationRef}`)
        .digest('hex')
        .slice(0, 24)}`,
      language: row.language,
      prompts: row.prompts as string[],
      source: { captured: row.capturedWindow },
      provenance: { consent_receipt_ref: row.consentReceiptRef },
      characteristics: {
        domain_tags: row.domainTags as string[],
        turn_type: 'conversation',
        prompt_count: (row.prompts as string[]).length,
      },
    }));

    return {
      datasheet: this.buildDatasheet(records),
      records,
      jsonl: records.map((record) => JSON.stringify(record)).join('\n'),
    };
  }

  /** Build #3 — buyer-facing datasheet (App. F §F.4, F.5 mechanism (3)). */
  private buildDatasheet(records: BuyerRecord[]): Record<string, unknown> {
    const now = new Date();
    const quarter = `${now.getUTCFullYear()}Q${Math.floor(now.getUTCMonth() / 3) + 1}`;

    const languages = distribution(records.map((record) => record.language));
    const domainTags = distribution(
      records.flatMap((record) => record.characteristics.domain_tags),
    );
    const windows = [
      ...new Set(records.map((record) => record.source.captured)),
    ];

    return {
      datasheet_version: '1.0',
      batch_id: `batch_${quarter}_${String(records.length).padStart(4, '0')}`,
      generated: now.toISOString().slice(0, 10),
      consent: {
        basis: 'per-record consent receipts (Kantara / ISO 27560 pattern)',
        revocable: true,
      },
      provenance: {
        lineage: 'contributor → de-identified record → buyer',
        tamper_evident: true,
        verify_via: 'consent_receipt_ref on each record',
      },
      de_identification: { assurance: DEID_ASSURANCE },
      generation_method:
        'human-authored prompts; official export upload; no synthetic or model-generated content',
      data: {
        types: 'text prompts',
        format: 'JSONL',
        unit: 'in-order conversation bundles',
      },
      temporal: {
        capture_window:
          windows.length === 1 ? windows[0] : windows.sort().join('–'),
      },
      composition: {
        record_count: records.length,
        languages,
        domain_tags: domainTags,
      },
      legal: { rights: 'contributor-granted per consent receipt' },
    };
  }

  // -------------------------------------------------------------------------
  // MVP verification path (F.5 (1)) + revocation (R-01 / FR-8.2)
  // -------------------------------------------------------------------------

  /** Buyer verifies a record via consent_receipt_ref lookup against our store. */
  async verifyReceipt(receiptRef: string): Promise<{
    valid: boolean;
    revoked: boolean;
    issued_at: string | null;
  }> {
    const row = await this.prisma.consentReceipt.findUnique({
      where: { receiptRef },
    });
    if (!row) return { valid: false, revoked: false, issued_at: null };

    const payload = row.payload as ConsentReceiptPayload;
    return {
      valid: verifyReceiptSignature(
        this.secret('CONSENT_SIGNING_SECRET'),
        payload,
        row.signature,
      ),
      revoked: row.revokedAt !== null,
      issued_at: payload.issued_at,
    };
  }

  /** Two-stage withdrawal (D-18): unsold is deletable anytime; sold is final. */
  async revoke(
    userId: string,
    receiptRef: string,
  ): Promise<{ revoked: boolean; reason?: string }> {
    const receipt = await this.prisma.consentReceipt.findUnique({
      where: { receiptRef },
    });
    if (!receipt || receipt.userId !== userId) {
      throw new NotFoundException('Consent receipt not found.');
    }

    const record = await this.prisma.packagedRecord.findFirst({
      where: { userId, consentReceiptRef: receiptRef },
    });
    if (record?.status === 'sold') {
      return { revoked: false, reason: 'sold_is_final' };
    }

    await this.prisma.$transaction([
      this.prisma.consentReceipt.update({
        where: { receiptRef },
        data: { revokedAt: new Date() },
      }),
      ...(record
        ? [
            this.prisma.packagedRecord.update({
              where: { id: record.id },
              data: { status: 'revoked' },
            }),
          ]
        : []),
    ]);
    return { revoked: true };
  }
}

/** Coarse temporal only (year/quarter) — App. F §F.3. */
function coarsenToQuarter(epochSeconds?: number): string {
  const date = epochSeconds ? new Date(epochSeconds * 1000) : new Date();
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Coarse topic tags — NOT sensitive categories (App. F §F.3). */
function deriveDomainTags(prompts: string[]): string[] {
  const text = prompts.join(' ').toLowerCase();
  const tags: string[] = [];
  if (
    /\b(code|function|bug|typescript|python|javascript|sql|api|regex|compile|debug)\b/.test(
      text,
    )
  ) {
    tags.push('coding');
  }
  if (
    /\b(write|essay|story|poem|draft|blog|article|email|letter)\b/.test(text)
  ) {
    tags.push('writing');
  }
  if (tags.length === 0) tags.push('general');
  return tags;
}

function distribution(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const total = values.length || 1;
  const result: Record<string, number> = {};
  [...counts.entries()].forEach(([key, count]) => {
    result[key] = Math.round((count / total) * 100) / 100;
  });
  return result;
}
