/**
 * Word counting + tier assignment (Stage 8 tracker §6.1). Pure.
 *
 * The app holds a copy of these rules (mcsa_app sources/services) to count
 * tiers for the rough estimate; the two repos cannot share code, so both
 * test suites run the same WORD_COUNT vectors to keep them in agreement.
 */
import type { Tier, TierCounts } from './valuation.types';

/** Word count = whitespace-delimited tokens. `[PERSON_1]` counts as one word. */
export const wordCount = (text: string): number =>
  text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;

/** < 10 words → short · 10–50 words → medium (both edges inclusive) · > 50 → long. */
export function tierOf(text: string): Tier {
  const words = wordCount(text);
  if (words < 10) return 'short';
  if (words <= 50) return 'medium';
  return 'long';
}

export function tierCounts(prompts: string[]): TierCounts {
  const counts: TierCounts = { short: 0, medium: 0, long: 0 };
  for (const prompt of prompts) counts[tierOf(prompt)] += 1;
  return counts;
}
