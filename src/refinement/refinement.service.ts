/**
 * Ephemeral processing service (spec §7.3, FR-3.6).
 *
 * Stateless between requests. All content lives in local variables and is
 * garbage-collected after the response — nothing raw or intermediate is
 * written to disk, and log lines carry metadata only (counts, types, reason
 * codes; never text). Persisted artefacts are limited to fingerprints and
 * attestation metadata (INV-1 / INV-9).
 *
 * Fail closed: if the detector is unavailable or errors, every record in
 * the batch is EXCLUDED (Appendix D §D.3 — flagging defers a decision, it
 * never waives it).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chainHash } from './attestation/hash-chain';
import { processRecord } from './policy/pipeline';
import { STAGE6_POLICY_VERSION } from './policy/thresholds';
import { ProcessRecordsDto } from './dto/process-records.dto';
import { DETECTOR } from './refinement.types';
import type {
  AttestationPayload,
  Detector,
  PipelineOutcome,
} from './refinement.types';

export type ProcessResponse = {
  results: {
    clientRecordId: string;
    outcome: string;
    reasonCodes: string[];
    attestationId: string | null;
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

    const outcomes: PipelineOutcome[] = [];

    for (const record of dto.records) {
      let outcome: PipelineOutcome;
      try {
        const spans = await this.detector.analyze(record.refinedText);
        outcome = processRecord(
          {
            clientRecordId: record.clientRecordId,
            refinedText: record.refinedText,
            flaggedCategoryIds: record.flaggedCategoryIds,
            exactHash: record.exactHash,
            simHash: record.simHash,
          },
          spans,
          versions,
        );
      } catch {
        // Detector down → fail closed (never fail open).
        outcome = this.failClosedOutcome(
          record.clientRecordId,
          record.exactHash,
          dto,
        );
      }
      outcomes.push(outcome);
    }

    const attestationIds = await this.persistProofs(userId, dto, outcomes);

    const counts = { kept: 0, excluded: 0, dropped: 0 };
    outcomes.forEach((outcome) => {
      if (outcome.outcome === 'kept') counts.kept += 1;
      else if (outcome.outcome === 'excluded') counts.excluded += 1;
      else counts.dropped += 1;
    });

    // Metadata-only operator telemetry (E.1.8 / NFR-7).
    this.logger.log(
      `processed batch user=${userId} records=${outcomes.length} kept=${counts.kept} excluded=${counts.excluded} dropped=${counts.dropped}`,
    );

    return {
      results: outcomes.map((outcome, index) => ({
        clientRecordId: outcome.clientRecordId,
        outcome: outcome.outcome,
        reasonCodes: outcome.reasonCodes,
        attestationId: attestationIds[index],
      })),
      policyVersion: STAGE6_POLICY_VERSION,
      keptCount: counts.kept,
      excludedCount: counts.excluded,
      droppedCount: counts.dropped,
    };
  }

  private failClosedOutcome(
    clientRecordId: string,
    exactHash: string,
    dto: ProcessRecordsDto,
  ): PipelineOutcome {
    const attestation: AttestationPayload = {
      record_fingerprint: exactHash,
      consent_receipt_ref: null,
      stage4_ruleset_version: dto.rulesetVersion,
      stage6_policy_version: STAGE6_POLICY_VERSION,
      thresholds_version: 'n/a',
      model_id: this.detector.id,
      model_version: this.detector.version,
      gazetteer_version: 'n/a',
      identifiers_redacted: [],
      generalisations_applied: [],
      qi_count_before: 0,
      qi_count_after: 0,
      singling_out_suppression: { fired: false, qi_types_suppressed: [] },
      attribution_buckets_fired: [],
      third_party_data_present: false,
      fiction_recovery_applied: false,
      gazetteer_allows: [],
      categories_flagged_stage4:
        dto.records.find((record) => record.clientRecordId === clientRecordId)
          ?.flaggedCategoryIds ?? [],
      categories_screened_stage6: [],
      category_outcome: 'excluded',
      actions_taken: ['EXCLUDE'],
      reason_codes: ['EXC_STAGE6_UNAVAILABLE'],
      standard: 'de-identified for the buyer; pseudonymised internally',
    };
    return {
      clientRecordId,
      outcome: 'excluded',
      reasonCodes: ['EXC_STAGE6_UNAVAILABLE'],
      finalText: null,
      attestation,
      operatorLog: [],
    };
  }

  /**
   * Crossing (2): only fingerprints + attestation metadata persist.
   * Attestations are hash-chained in insertion order (R-06).
   */
  private async persistProofs(
    userId: string,
    dto: ProcessRecordsDto,
    outcomes: PipelineOutcome[],
  ): Promise<(string | null)[]> {
    const ids: (string | null)[] = [];

    try {
      await this.prisma.recordFingerprint.createMany({
        data: dto.records.map((record) => ({
          userId,
          exactHash: record.exactHash,
          simHash: record.simHash,
          rulesetVersion: dto.rulesetVersion,
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
        ids.push(row.id);
        prevHash = hash;
      }
    } catch (error) {
      // Proof store unavailable (e.g. local dev without Postgres). The
      // pipeline result is still returned; nothing content-bearing was at
      // stake. Metadata-only log.
      this.logger.warn(
        `proof store unavailable — attestations not persisted (${(error as Error).name})`,
      );
      while (ids.length < outcomes.length) ids.push(null);
    }

    while (ids.length < outcomes.length) ids.push(null);
    return ids;
  }
}
