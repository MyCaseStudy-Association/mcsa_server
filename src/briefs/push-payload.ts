/**
 * The device push payload (tracker §5.3) — the ONLY representation of a
 * brief that ever leaves the server. Pure and tested so the INV-8 boundary
 * is enforced by code, not convention:
 *   - only `live` + escrow-committed (D-16) + unexpired briefs are pushed;
 *   - only briefRef, categoryId, spec and maxRedactionDensity cross —
 *     buyer identity, price, volume and escrow state never do.
 */
import type {
  DeviceBrief,
  DevicePushPayload,
  PushableBrief,
} from './briefs.types';
import { isBuyerCategoryId } from './taxonomy';

export const PUSH_PAYLOAD_VERSION = '2026-09-20.1';

export function isPushable(brief: PushableBrief, now: Date): boolean {
  return (
    brief.status === 'live' &&
    brief.escrowCommitted &&
    brief.expiresAt.getTime() > now.getTime() &&
    isBuyerCategoryId(brief.buyer.categoryId)
  );
}

export function toDeviceBrief(brief: PushableBrief): DeviceBrief {
  if (!isBuyerCategoryId(brief.buyer.categoryId)) {
    throw new Error(`Unknown buyer category: ${brief.buyer.categoryId}`);
  }
  return {
    briefRef: brief.briefRef,
    categoryId: brief.buyer.categoryId,
    spec: {
      domains: [...brief.spec.domains],
      languages: [...brief.spec.languages],
      keywordsAny: [...brief.spec.keywordsAny],
      keywordsAll: [...brief.spec.keywordsAll],
      keywordsNone: [...brief.spec.keywordsNone],
      minPromptsPerConversation: brief.spec.minPromptsPerConversation,
    },
    quality: { maxRedactionDensity: brief.quality.maxRedactionDensity },
  };
}

export function toDevicePayload(
  briefs: PushableBrief[],
  now: Date = new Date(),
): DevicePushPayload {
  return {
    payloadVersion: PUSH_PAYLOAD_VERSION,
    briefs: briefs.filter((brief) => isPushable(brief, now)).map(toDeviceBrief),
  };
}
