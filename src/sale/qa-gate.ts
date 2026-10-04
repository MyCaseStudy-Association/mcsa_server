/**
 * The QA gate (Stage 8 Build #7 §7.1.1, FR-3.4 as a PRE-COMMITMENT gate,
 * APP-D-17). Pure, deterministic, no model (D-26).
 *
 * Re-checks a matched conversation against the brief's machine-checkable
 * conditions, this time on the FINAL de-identified text that would actually
 * ship. On-device matching (Build #5) read the original text and is only a
 * pre-filter; this is the binding check. Redaction can remove a keyword the
 * device saw, so a device match may legitimately fail here.
 *
 * Also enforces the selection preconditions the tracker puts on QA: the
 * brief is still live (D-16), the conversation was consented for this
 * buyer category, consent is not revoked, and the jurisdiction is a
 * confirmed US/CA (FR-6.6).
 *
 * Output is failure CODES only — never the text or keyword that failed. A
 * failed conversation is simply not selectable; it is never "rejected" to
 * the contributor (§7.5).
 */
import type { BriefQuality, BriefSpec } from '../briefs/briefs.types';
import type { DedupStatus } from './dedup';
import { matchesKeyword } from './keyword-match';

export const QA_GATE_VERSION = '0.1';

export type QaFailureCode =
  | 'QA_BRIEF_NOT_LIVE'
  | 'QA_NOT_PACKAGED'
  | 'QA_NO_CONSENT'
  | 'QA_CONSENT_REVOKED'
  | 'QA_CATEGORY_NOT_CONSENTED'
  | 'QA_JURISDICTION'
  | 'QA_LANGUAGE'
  | 'QA_DOMAIN'
  | 'QA_MIN_PROMPTS'
  | 'QA_REDACTION_DENSITY'
  | 'QA_KEYWORDS_ANY'
  | 'QA_KEYWORDS_ALL'
  | 'QA_KEYWORDS_NONE'
  | 'QA_DUPLICATE';

export type QaCandidate = {
  /** Kept prompts after Stage 6, de-identified, in turn order. */
  finalPrompts: string[];
  /** Device language verdict (Build #8.2): 'en' | 'other' | 'und'. */
  language: string;
  /** Device domain tags (Build #8.1), computed once on original text. */
  domainTags: string[];
  dedupStatus: DedupStatus;
  consent: {
    present: boolean;
    revoked: boolean;
    buyerCategories: string[];
    jurisdiction: string | null;
  };
};

export type QaBrief = {
  /** status live + escrow committed + not expired, evaluated by the caller. */
  live: boolean;
  categoryId: string;
  spec: BriefSpec;
  quality: BriefQuality;
};

export type QaResult = {
  pass: boolean;
  failures: QaFailureCode[];
  /** Placeholder share of the final text; stored for selection ranking (§7.2). */
  redactionDensity: number;
};

const PLACEHOLDER = /^\[[A-Z_0-9]+\]$/;

/**
 * Placeholder tokens / all tokens across the conversation's final prompts.
 * Same definition as the device pre-filter (brief-match.ts).
 */
export function redactionDensity(prompts: string[]): number {
  const tokens = prompts.flatMap((prompt) =>
    prompt.trim().split(/\s+/).filter(Boolean),
  );
  if (tokens.length === 0) return 1; // an empty bundle fails every bar
  return (
    tokens.filter((token) => PLACEHOLDER.test(token)).length / tokens.length
  );
}

const CONFIRMED_JURISDICTIONS = ['US', 'CA'];

export function qaGate(candidate: QaCandidate, brief: QaBrief): QaResult {
  const failures: QaFailureCode[] = [];
  const { spec, quality } = brief;
  const density = redactionDensity(candidate.finalPrompts);

  // Preconditions: nothing enters QA against a non-live brief (§7.5).
  if (!brief.live) failures.push('QA_BRIEF_NOT_LIVE');
  if (candidate.finalPrompts.length === 0) failures.push('QA_NOT_PACKAGED');

  // Consent, as recorded in the signed receipt, not as the device claims.
  if (!candidate.consent.present) {
    failures.push('QA_NO_CONSENT');
  } else {
    if (candidate.consent.revoked) failures.push('QA_CONSENT_REVOKED');
    if (!candidate.consent.buyerCategories.includes(brief.categoryId)) {
      failures.push('QA_CATEGORY_NOT_CONSENTED');
    }
    if (
      candidate.consent.jurisdiction === null ||
      !CONFIRMED_JURISDICTIONS.includes(candidate.consent.jurisdiction)
    ) {
      failures.push('QA_JURISDICTION');
    }
  }

  // Brief spec — same order and semantics as the device matcher.
  if (
    spec.languages.length > 0 &&
    !spec.languages.includes(candidate.language)
  ) {
    failures.push('QA_LANGUAGE');
  }
  if (
    spec.domains.length > 0 &&
    !candidate.domainTags.some((tag) => spec.domains.includes(tag))
  ) {
    failures.push('QA_DOMAIN');
  }
  if (candidate.finalPrompts.length < spec.minPromptsPerConversation) {
    failures.push('QA_MIN_PROMPTS');
  }
  if (density > quality.maxRedactionDensity) {
    failures.push('QA_REDACTION_DENSITY');
  }

  const text = candidate.finalPrompts.join(' ');
  const has = (keyword: string) => matchesKeyword(text, keyword);
  if (spec.keywordsAny.length > 0 && !spec.keywordsAny.some(has)) {
    failures.push('QA_KEYWORDS_ANY');
  }
  if (!spec.keywordsAll.every(has)) failures.push('QA_KEYWORDS_ALL');
  if (spec.keywordsNone.some(has)) failures.push('QA_KEYWORDS_NONE');

  if (
    candidate.dedupStatus === 'exact_duplicate' ||
    (candidate.dedupStatus === 'near_duplicate' &&
      quality.dedupGuarantee === 'exact+near')
  ) {
    failures.push('QA_DUPLICATE');
  }

  return { pass: failures.length === 0, failures, redactionDensity: density };
}
