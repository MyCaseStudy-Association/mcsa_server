/**
 * Build #4 — consent receipt (F.5 mechanism (2), §5.2, FR-5.1, INV-7).
 * ONE per conversation (APP-D-08), Kantara / ISO 27560 consent-record
 * pattern. Carries a pseudonymous contributor id (never raw identity) and
 * the exact-hash fingerprints of every INCLUDED prompt — the binding that
 * makes the receipt verifiable against a delivered record.
 *
 * MVP signature: HMAC-SHA256 over the canonical receipt JSON with a
 * platform secret. Offline-verifiable asymmetric per-record signatures stay
 * deferred per F.7 (Phase 1, buyer-requested only).
 */
import { createHmac, randomUUID } from 'node:crypto';

export type ConsentReceiptPayload = {
  receipt_id: string;
  receipt_version: '1.0';
  pattern: 'Kantara consent-receipt / ISO-IEC 27560';
  issued_at: string;
  contributor: { pseudonymous_id: string };
  scope: {
    content: 'prompts-only';
    source_provider: string;
    conversation_fingerprints: string[];
  };
  purpose: 'sale/licence for AI training / RLHF';
  authorisation: {
    buyer_categories: string[];
    notify_on_sale: true;
  };
  disclosures: { version: string; shown: string[] };
  jurisdiction: 'US' | 'CA';
  revocation: { revocable_while_unsold: true; revoked_at: null };
};

export type ConsentContext = {
  disclosuresVersion: string;
  disclosuresShown: string[];
  buyerCategories: string[];
  jurisdiction: 'US' | 'CA';
};

/** Stable pseudonymous contributor id — the re-link key stays in the vault (OD-05). */
export function pseudonymousId(secret: string, userId: string): string {
  return `pseu_${createHmac('sha256', secret).update(userId).digest('hex').slice(0, 24)}`;
}

export function buildConsentReceipt(input: {
  pseudonymousContributorId: string;
  sourceProvider: string;
  keptFingerprints: string[]; // exact hashes of included prompts, in turn order
  consent: ConsentContext;
}): { receiptRef: string; payload: ConsentReceiptPayload } {
  const receiptRef = `rcpt_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const payload: ConsentReceiptPayload = {
    receipt_id: receiptRef,
    receipt_version: '1.0',
    pattern: 'Kantara consent-receipt / ISO-IEC 27560',
    issued_at: new Date().toISOString(),
    contributor: { pseudonymous_id: input.pseudonymousContributorId },
    scope: {
      content: 'prompts-only',
      source_provider: input.sourceProvider,
      conversation_fingerprints: input.keptFingerprints,
    },
    purpose: 'sale/licence for AI training / RLHF',
    authorisation: {
      buyer_categories: input.consent.buyerCategories,
      notify_on_sale: true,
    },
    disclosures: {
      version: input.consent.disclosuresVersion,
      shown: input.consent.disclosuresShown,
    },
    jurisdiction: input.consent.jurisdiction,
    revocation: { revocable_while_unsold: true, revoked_at: null },
  };
  return { receiptRef, payload };
}

/** Platform signature over the canonical receipt JSON (§5.2). */
export function signReceipt(
  secret: string,
  payload: ConsentReceiptPayload,
): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function verifyReceiptSignature(
  secret: string,
  payload: ConsentReceiptPayload,
  signature: string,
): boolean {
  return signReceipt(secret, payload) === signature;
}
