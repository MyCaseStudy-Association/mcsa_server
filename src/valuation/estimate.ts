/**
 * Rough estimate (Build #6 §6.2) — the range shown on the consent screen.
 * Pure: counts in, range out. Nothing is persisted or logged (INV-1 posture).
 *
 * Input is one TierCounts per selected, brief-matched conversation (D2/D3,
 * 29 Sep): the device already filtered to matched chats and Stage-4-kept
 * prompts. The server cannot verify counts before consent — the binding
 * value is the precise valuation after QA (precise-valuation.ts).
 */
import {
  ATTRITION_PERCENT,
  PRICING_SCHEDULE_VERSION,
  conversationCents,
} from './pricing-schedule';
import type { EstimateResponse, TierCounts } from './valuation.types';

export function estimateRange(conversations: TierCounts[]): EstimateResponse {
  const highCents = conversations.reduce(
    (sum, counts) => sum + conversationCents(counts),
    0,
  );
  // Integer math: round DOWN so the low end never over-promises (D-17).
  const lowCents = Math.floor((highCents * (100 - ATTRITION_PERCENT)) / 100);
  return {
    lowCents,
    highCents,
    currency: 'USD',
    scheduleVersion: PRICING_SCHEDULE_VERSION,
  };
}
