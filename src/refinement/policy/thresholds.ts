/**
 * Component (3) — confidence-threshold policy (Appendix E §E.2, APP-D-09).
 *
 * TIER A CONFIG — safety-critical. Changes require code review and a
 * STAGE6_POLICY_VERSION bump; never dashboard-editable (E.2.4). Numbers are
 * provisional until the evaluation harness (§E.6) measures them.
 *
 * Governing asymmetry: protective actions fire early, permissive actions
 * fire late. The uncertain band (category_suppress..category_exclude) maps
 * to SUPPRESS — never to "ignore" (E.2.1).
 */
export const STAGE6_POLICY_VERSION = '0.1-draft';
export const THRESHOLDS_VERSION = '0.1';

export const THRESHOLDS = {
  redact_identifier: 0.0, // any detection
  redact_person: 0.3,
  generalise: 0.4,
  category_suppress: 0.35, // band opens
  category_exclude: 0.75, // band closes
  allow_fiction: 0.85, // recovery must be harder than protection
} as const;

/** Absolute count of direct-identifier spans that excludes a record (E.1.6). */
export const PII_DENSITY_EXCLUDE_COUNT = 15;

/** Quality ceilings (E.1.7) — Tier B operationally, kept here for the MVP. */
export const REDACTION_DENSITY_CEILING = 0.25;
export const MIN_REAL_TOKENS = 10;

/** Singling-out check (E.3.3): more distinct QI types than this → suppress. */
export const MAX_QI_TYPES = 3;

// ---------------------------------------------------------------------------
// Conversation-wide singling-out (APP-D-15, Build #1b). Thresholds 5/4/8 are
// PROVISIONAL — calibrate against real data via the eval harness (Testing
// Plan). Tier A (per-prompt, MAX_QI_TYPES above) is unchanged.
// ---------------------------------------------------------------------------

/** Tier B: ≥ this many distinct QI types across the bundle → suppress. */
export const QI_CONVERSATION_SUPPRESS = 5;
/** Tier B suppresses most-distinctive-first down to ≤ this many. */
export const QI_CONVERSATION_TARGET = 4;
/** Tier C backstop: ≥ this many distinct QI types → exclude the conversation. */
export const QI_CONVERSATION_EXCLUDE = 8;

/** "Gutting" (Tier B → C failover): suppression touches > this share of prompts… */
export const GUTTING_MAX_TOUCHED_RATIO = 0.4;
/** …or leaves fewer than this many usable prompts. */
export const GUTTING_MIN_USABLE_PROMPTS = 2;
