/**
 * Ephemeral processing service (spec §7.3, FR-3.6).
 *
 * Stateless between requests. All content lives in local variables and is
 * garbage-collected after the response — nothing raw or intermediate is
 * written to disk, and log lines carry metadata only (counts, types, reason
 * codes; never text). Persisted artefacts are limited to fingerprints,
 * attestation metadata, the signed consent receipt, and the de-identified
 * packaged bundle (INV-1 / INV-9, Crossing (2)).
 *
 * Build #1: the unit of work is the CONVERSATION (APP-D-08) — records are
 * grouped by conversationId and processed with one ephemeral pseudonym map
 * per conversation. Fail closed: if the detector is unavailable or errors,
 * the affected records are EXCLUDED (Appendix D §D.3).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chainHash } from './attestation/hash-chain';
import { processConversation } from './policy/conversation';
import { STAGE6_POLICY_VERSION } from './policy/thresholds';
import { PackagingService } from './packaging/packaging.service';
import { ProcessRecordsDto } from './dto/process-records.dto';
import { DETECTOR } from './refinement.types';
import type {
  ConversationOutcome,
  Detector,
  PipelineOutcome,
  RecordInput,
} from './refinement.types';

export type ProcessResponse = {
  results: {
    clientRecordId: string;
    outcome: string;
    reasonCodes: string[];
    attestationId: string | null;
  }[];
  conversations: {
    conversationId: string;
    keptCount: number;
    consentReceiptRef: string | null;
    packagedRecordRef: string | null;
  }[];
  policyVersion: string;
  keptCount: number;
  excludedCount: number;
  droppedCount: number;
};

@Injectable()
export class RefinementService {
  private readonly logger = new Logger(RefinementService.name);

  constructor(
    @Inject(DETECTOR) private readonly detector: Detector,
    private readonly prisma: PrismaService,
    private readonly packaging: PackagingService,
  ) {}

  async process(
    userId: string,
    dto: ProcessRecordsDto,
  ): Promise<ProcessResponse> {
    const versions = {
      stage4RulesetVersion: dto.rulesetVersion,
      modelId: this.detector.id,
      modelVersion: this.detector.version,
    };

    // --- Build #1: group by conversation, first-seen order ---------------
    const groups = new Map<string, RecordInput[]>();
    for (const record of dto.records) {
      const input: RecordInput = {
        clientRecordId: record.clientRecordId,
        conversationId: record.conversationId,
        turnIndex: record.turnIndex,
        refinedText: record.refinedText,
        flaggedCategoryIds: record.flaggedCategoryIds,
        exactHash: record.exactHash,
        simHash: record.simHash,
        capturedAt: record.capturedAt,
      };
      const group = groups.get(record.conversationId);
      if (group) group.push(input);
      else groups.set(record.conversationId, [input]);
    }

    const conversations: ConversationOutcome[] = [];
    for (const records of groups.values()) {
      conversations.push(
        await processConversation(
          records,
          (text) => this.detector.analyze(text),
          versions,
        ),
      );
    }

    // --- Builds #4 + #2: receipt → proofs → packaged bundle --------------
    const conversationSummaries: ProcessResponse['conversations'] = [];
    const attestationIdByRecord = new Map<string, string | null>();

    for (const conversation of conversations) {
      const kept = conversation.outcomes.filter(
        (outcome) => outcome.outcome === 'kept',
      );
      let receiptRef: string | null = null;
      let recordRef: string | null = null;

      try {
        // Receipt FIRST, so attestations persist with the ref (not null).
        receiptRef = await this.packaging.createReceipt(
          userId,
          conversation,
          dto.sourceProvider,
          dto.consent,
        );

        const chainTail = await this.persistProofs(
          userId,
          dto.rulesetVersion,
          groups.get(conversation.conversationId) ?? [],
          conversation.outcomes,
          attestationIdByRecord,
        );

        if (receiptRef) {
          recordRef = await this.packaging.createPackagedRecord(
            userId,
            conversation,
            receiptRef,
            chainTail,
            groups.get(conversation.conversationId)?.[0]?.capturedAt,
          );
        }
      } catch (error) {
        // Proof store unavailable (e.g. local dev without Postgres). The
        // pipeline result is still returned; nothing content-bearing at
        // stake beyond the unsellable bundle. Metadata-only log.
        this.logger.warn(
          `proof store unavailable — proofs/receipt/bundle not persisted (${(error as Error).name})`,
        );
      }

      conversationSummaries.push({
        conversationId: conversation.conversationId,
        keptCount: kept.length,
        consentReceiptRef: receiptRef,
        packagedRecordRef: recordRef,
      });
    }

    // --- Response in original request order ------------------------------
    const outcomeByRecord = new Map<string, PipelineOutcome>();
    conversations.forEach((conversation) =>
      conversation.outcomes.forEach((outcome) =>
        outcomeByRecord.set(outcome.clientRecordId, outcome),
      ),
    );

    const counts = { kept: 0, excluded: 0, dropped: 0 };
    const allOutcomes = [...outcomeByRecord.values()];
    allOutcomes.forEach((outcome) => {
      if (outcome.outcome === 'kept') counts.kept += 1;
      else if (outcome.outcome === 'excluded') counts.excluded += 1;
      else counts.dropped += 1;
    });

    // Metadata-only operator telemetry (E.1.8 / NFR-7).
    this.logger.log(
      `processed batch user=${userId} conversations=${conversations.length} records=${allOutcomes.length} kept=${counts.kept} excluded=${counts.excluded} dropped=${counts.dropped}`,
    );

    return {
      results: dto.records.map((record) => {
        const outcome = outcomeByRecord.get(record.clientRecordId);
        return {
          clientRecordId: record.clientRecordId,
          outcome: outcome?.outcome ?? 'excluded',
          reasonCodes: outcome?.reasonCodes ?? ['EXC_STAGE6_UNAVAILABLE'],
          attestationId:
            attestationIdByRecord.get(record.clientRecordId) ?? null,
        };
      }),
      conversations: conversationSummaries,
      policyVersion: STAGE6_POLICY_VERSION,
      keptCount: counts.kept,
      excludedCount: counts.excluded,
      droppedCount: counts.dropped,
    };
  }

  /**
   * Crossing (2): only fingerprints + attestation metadata persist.
   * Attestations are hash-chained in insertion order (R-06). Returns the
   * chain tail so the packaged record can extend it (FR-5.3).
   */
  private async persistProofs(
    userId: string,
    rulesetVersion: string,
    records: RecordInput[],
    outcomes: PipelineOutcome[],
    attestationIdByRecord: Map<string, string | null>,
  ): Promise<string | null> {
    await this.prisma.recordFingerprint.createMany({
      data: records.map((record) => ({
        userId,
        exactHash: record.exactHash,
        simHash: record.simHash,
        rulesetVersion,
      })),
      skipDuplicates: true,
    });

    const last = await this.prisma.deidAttestation.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { chainHash: true },
    });
    let prevHash: string | null = last?.chainHash ?? null;

    for (const outcome of outcomes) {
      const hash = chainHash(prevHash, outcome.attestation);
      const row = await this.prisma.deidAttestation.create({
        data: {
          recordFingerprint: outcome.attestation.record_fingerprint,
          payload: outcome.attestation,
          prevHash,
          chainHash: hash,
        },
        select: { id: true },
      });
      attestationIdByRecord.set(outcome.clientRecordId, row.id);
      prevHash = hash;
    }
    return prevHash;
  }
}
