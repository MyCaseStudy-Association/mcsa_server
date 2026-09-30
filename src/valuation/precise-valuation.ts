/**
 * Precise valuation (FR-3.1, Build #6 §6.3 as amended 29 Sep). Pure.
 *
 * Runs ONCE per conversation, AFTER it passes the QA gate (Build #7), on the
 * FINAL de-identified text. The result closes there: it ranks the candidate
 * in fulfilment selection and becomes the sale amount at commitment. It is
 * never recomputed, and the rough estimate is never billed against.
 *
 * Pricing only — eligibility belongs to QA. Build #7 wires the caller; the
 * caller attaches the conversation ref.
 */
import {
  PRICING_SCHEDULE_VERSION,
  conversationCents,
} from './pricing-schedule';
import { tierCounts } from './tiers';
import type { PreciseValuation } from './valuation.types';

export function preciseValue(finalPrompts: string[]): PreciseValuation {
  const counts = tierCounts(finalPrompts);
  return {
    tierCounts: counts,
    amountCents: conversationCents(counts),
    scheduleVersion: PRICING_SCHEDULE_VERSION,
  };
}
