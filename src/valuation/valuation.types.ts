/** Prompt-length tiers (Stage 8 tracker §6.1). */
export type Tier = 'short' | 'medium' | 'long';

/** How many prompts of a conversation fall in each tier. */
export type TierCounts = Record<Tier, number>;

/**
 * The rough estimate returned to the device (Build #6 §6.2, D1). Integer
 * CENTS, NET — the contributor's own earnings, never the split (D-33).
 */
export type EstimateResponse = {
  lowCents: number;
  highCents: number;
  currency: 'USD';
  scheduleVersion: string;
};

/** The one binding valuation (FR-3.1), computed once after QA passes (Build #7). */
export type PreciseValuation = {
  tierCounts: TierCounts;
  amountCents: number;
  scheduleVersion: string;
};
