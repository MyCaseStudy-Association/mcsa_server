import type { BuyerCategoryId } from './taxonomy';

export type BriefStatus = 'draft' | 'live' | 'paused' | 'filled' | 'expired';

/** Demand spec — deterministic, matchable on-device at $0/record (D-26). */
export type BriefSpec = {
  domains: string[];
  languages: string[];
  keywordsAny: string[];
  keywordsAll: string[];
  keywordsNone: string[];
  minPromptsPerConversation: number;
};

/** Buyer's quality floor. Only `maxRedactionDensity` is pushed to the device. */
export type BriefQuality = {
  maxRedactionDensity: number;
  dedupGuarantee: 'exact' | 'exact+near';
};

/** Server-only. `maxPerContributor: null` = no cap (ED, 16 Aug). */
export type BriefVolume = {
  targetConversations: number;
  maxPerContributor: number | null;
};

/** What a brief looks like on the device — and NOTHING more (§5.1/§5.3). */
export type DeviceBrief = {
  briefRef: string;
  categoryId: BuyerCategoryId;
  spec: BriefSpec;
  quality: { maxRedactionDensity: number };
};

export type DevicePushPayload = {
  payloadVersion: string;
  briefs: DeviceBrief[];
};

/** The minimal shape `toDevicePayload` needs — keeps the mapper Prisma-free. */
export type PushableBrief = {
  briefRef: string;
  status: string;
  escrowCommitted: boolean;
  expiresAt: Date;
  spec: BriefSpec;
  quality: BriefQuality;
  buyer: { categoryId: string };
};
