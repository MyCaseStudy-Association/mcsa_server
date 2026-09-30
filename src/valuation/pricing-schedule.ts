/**
 * Pricing schedule — Tier-B config, versioned (Stage 8 tracker §6.1).
 * Every change bumps PRICING_SCHEDULE_VERSION so past estimates and sales
 * stay interpretable.
 *
 * NET per-prompt amounts (ED, 16 Aug 2026): the platform split lives in the
 * buyer-side gross; the contributor sees these numbers as-is (D-33).
 * Integer CENTS everywhere (D1, 29 Sep) — floating-point money is how you
 * get $0.30000000000000004.
 */
import type { TierCounts } from './valuation.types';

export const PRICING_SCHEDULE_VERSION = '0.1';

export const PRICING_CENTS: TierCounts = { short: 1, medium: 5, long: 10 };

/**
 * Provisional (ED, 16 Aug) — calibrated via Testing Plan §2. A whole
 * percentage so the low-end math stays in integers.
 */
export const ATTRITION_PERCENT = 50;

/** Conversation value = Σ tier price over its prompts, in cents. */
export function conversationCents(counts: TierCounts): number {
  return (
    counts.short * PRICING_CENTS.short +
    counts.medium * PRICING_CENTS.medium +
    counts.long * PRICING_CENTS.long
  );
}
