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
