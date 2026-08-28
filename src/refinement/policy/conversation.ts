/**
 * Stage 6's unit of work is the CONVERSATION (APP-D-08, Build #1): all of a
 * contributor's surviving prompts from one chat, in original order.
 *
 * The pseudonym map exists only inside processConversation's scope: created
 * per conversation, garbage-collected when it returns — raw names never
 * persist or leave (INV-1). It cannot be reconstructed later; that is the
 * point. Pseudonyms therefore reset at the conversation boundary by
 * construction.
 *
 * Per-prompt exclusion stays exactly as built: a prompt that hits a
 * sensitive category is dropped on its own; the rest of the conversation
 * survives (an ordered gap).
 */
import { processRecord, PipelineVersions } from './pipeline';
import { applyConversationSinglingOut } from './singling-out';
import { STAGE6_POLICY_VERSION } from './thresholds';
import {
  AttestationPayload,
  ConversationOutcome,
  DetectedSpan,
  PipelineOutcome,
  PseudonymMap,
  RecordInput,
} from '../refinement.types';

export async function processConversation(
  records: RecordInput[], // all surviving prompts of ONE conversation
  analyze: (text: string) => Promise<DetectedSpan[]>,
  versions: PipelineVersions,
): Promise<ConversationOutcome> {
  const ordered = [...records].sort((a, b) => a.turnIndex - b.turnIndex);
  const conversationId = ordered[0]?.conversationId ?? '';

  // ONE map across the whole chat (E.1.4): [PERSON_1] = the same person in
  // every prompt; the map's lifetime IS the conversation's processing.
  const pseudonyms: PseudonymMap = new Map();

  const outcomes: PipelineOutcome[] = [];
  for (const record of ordered) {
    try {
      const spans = await analyze(record.refinedText);
      // Per-prompt logic unchanged — the map is injected, not rebuilt.
      outcomes.push(processRecord(record, spans, versions, pseudonyms));
    } catch {
      // Detector down → fail closed for this record (App. D §D.3 / E.2.5).
      outcomes.push(failClosedOutcome(record, versions));
    }
  }

  // Build #1b runs here, conversation-wide, before anything is returned.
  return applyConversationSinglingOut(conversationId, outcomes);
}

/** A record whose Stage 6 eval is unavailable is EXCLUDED — never kept. */
export function failClosedOutcome(
  record: RecordInput,
  versions: PipelineVersions,
): PipelineOutcome {
  const attestation: AttestationPayload = {
    record_fingerprint: record.exactHash,
    consent_receipt_ref: null,
    stage4_ruleset_version: versions.stage4RulesetVersion,
    stage6_policy_version: STAGE6_POLICY_VERSION,
    thresholds_version: 'n/a',
    model_id: versions.modelId,
    model_version: versions.modelVersion,
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
    categories_flagged_stage4: record.flaggedCategoryIds,
    categories_screened_stage6: [],
    category_outcome: 'excluded',
    actions_taken: ['EXCLUDE'],
    reason_codes: ['EXC_STAGE6_UNAVAILABLE'],
    standard: 'de-identified for the buyer; pseudonymised internally',
  };
  return {
    clientRecordId: record.clientRecordId,
    conversationId: record.conversationId,
    turnIndex: record.turnIndex,
    outcome: 'excluded',
    reasonCodes: ['EXC_STAGE6_UNAVAILABLE'],
    finalText: null,
    attestation,
    operatorLog: [],
  };
}
