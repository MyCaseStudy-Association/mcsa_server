/**
 * Stage 6 shared types (spec §7.3.1 anatomy, Appendix E).
 *
 * Everything here is in-memory only. `DetectedSpan.text` exists so the
 * pipeline can act on a span; it must never be logged or persisted
 * (INV-1, E.1.8).
 */

/**
 * Canonical entity types every detector implementation maps into:
 * EMAIL, PHONE, GOV_ID, ACCOUNT, IP, URL, HANDLE, POSTAL, GEO_COORD,
 * ADDRESS, MEDICAL_LICENSE, SECRET, PERSON, ORG, GPE, LOC, FAC, DATE, AGE,
 * NORP. Deliberately an open string: unknown labels are legal input — the
 * entity mapping fails closed on them (group H: REDACT + log).
 */
export type CanonicalEntityType = string;

export type DetectedSpan = {
  type: CanonicalEntityType;
  start: number;
  end: number;
  /** In-memory only. NEVER log or persist this field. */
  text: string;
  confidence: number;
};

/** Component (1) — the swappable detector (OD-03). */
export interface Detector {
  readonly id: string;
  readonly version: string;
  analyze(text: string): Promise<DetectedSpan[]>;
}

export const DETECTOR = Symbol('DETECTOR');

export type AttributionBucket =
  'self' | 'third_party' | 'fiction' | 'ambiguous' | 'unattributed';

export type FictionTier = 'strong' | 'medium' | 'weak' | null;

export type SentenceAttribution = {
  bucket: AttributionBucket;
  confidence: number;
  fictionTier: FictionTier;
};

export type Sentence = {
  index: number;
  start: number;
  end: number;
  text: string;
};

export type RecordInput = {
  clientRecordId: string;
  /** Groups a contributor's prompts from one chat (APP-D-08, Build #1). */
  conversationId: string;
  /** Original position within the chat — order is the product. */
  turnIndex: number;
  refinedText: string;
  flaggedCategoryIds: string[];
  exactHash: string;
  simHash: string;
  /** Optional epoch seconds of the source chat's creation (coarsened later). */
  capturedAt?: number;
};

/**
 * One ephemeral pseudonym map per CONVERSATION (E.1.4): "sarah jones" → 1.
 * Lives only inside processConversation's scope; destroyed after (INV-1).
 */
export type PseudonymMap = Map<string, number>;

export type QiType =
  | 'rare_attribute'
  | 'exact_age'
  | 'occupation'
  | 'employer'
  | 'family_structure'
  | 'education'
  | 'gender'
  | 'geo';

export type QiHit = {
  type: QiType;
  /** Range (original-text offsets) to redact if singling-out suppresses it. */
  start: number;
  end: number;
  placeholder: string;
};

export type RecordOutcomeKind = 'kept' | 'excluded' | 'dropped';

/**
 * Component (6) — attestation payload (E.5.1). METADATA ONLY.
 * No prompt text, no matched entity text, ever (E.5.3).
 */
export type AttestationPayload = {
  record_fingerprint: string;
  consent_receipt_ref: string | null;
  stage4_ruleset_version: string;
  stage6_policy_version: string;
  thresholds_version: string;
  model_id: string;
  model_version: string;
  gazetteer_version: string;
  identifiers_redacted: { type: string; count: number }[];
  generalisations_applied: string[];
  qi_count_before: number;
  qi_count_after: number;
  singling_out_suppression: { fired: boolean; qi_types_suppressed: string[] };
  attribution_buckets_fired: string[];
  third_party_data_present: boolean;
  fiction_recovery_applied: boolean;
  gazetteer_allows: string[]; // Wikidata Q-IDs only — never names (E.1.8)
  categories_flagged_stage4: string[];
  categories_screened_stage6: string[];
  category_outcome: 'none' | 'suppressed' | 'excluded';
  actions_taken: string[];
  reason_codes: string[];
  standard: 'de-identified for the buyer; pseudonymised internally';
};

/** Metadata-only operator log entry (E.1.8) — safe to persist/emit. */
export type OperatorLogEntry = {
  entityType: string;
  action: string;
  confidence: number;
  start: number;
  end: number;
  detail?: string; // reason code or Q-ID — never content
};

/**
 * In-memory working state a kept outcome carries so the conversation-wide
 * singling-out check (Build #1b) can re-materialise the text with extra
 * suppressions. Offsets refer to the ORIGINAL refined text. NEVER persisted
 * or logged — it rides the outcome only until applyConversationSinglingOut
 * returns (E.1.8).
 */
export type OutcomeRework = {
  /** Original (first-pass-redacted) text. In-memory only. */
  text: string;
  suppressedSentences: number[];
  edits: { start: number; end: number; replacement: string }[];
  /** QI hits that SURVIVED the per-prompt Tier A check. */
  qiHits: QiHit[];
};

export type PipelineOutcome = {
  clientRecordId: string;
  conversationId: string;
  turnIndex: number;
  outcome: RecordOutcomeKind;
  reasonCodes: string[];
  /** De-identified text. In-memory only; discarded after the response (INV-1). */
  finalText: string | null;
  attestation: AttestationPayload;
  operatorLog: OperatorLogEntry[];
  /** Present on kept outcomes only. In-memory only (see OutcomeRework). */
  rework?: OutcomeRework;
};

export type ConversationOutcome = {
  conversationId: string;
  outcomes: PipelineOutcome[];
};
