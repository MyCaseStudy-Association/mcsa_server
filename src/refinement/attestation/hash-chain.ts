import { createHash } from 'node:crypto';
import { AttestationPayload } from '../refinement.types';

/**
 * Tamper-evident hash chain over attestation payloads (R-06, OD-04).
 * chainHash = sha256(prevHash || 'genesis', canonical payload JSON).
 */
export function chainHash(
  prevHash: string | null,
  payload: AttestationPayload,
): string {
  return extendChain(prevHash, JSON.stringify(payload));
}

/**
 * FR-5.3: the same chain construction, reused to link Stage 7 packaged
 * records onto the attestation chain tail (metadata JSON only, never text).
 */
export function extendChain(
  prevHash: string | null,
  payloadJson: string,
): string {
  return createHash('sha256')
    .update(prevHash ?? 'genesis')
    .update(payloadJson)
    .digest('hex');
}
