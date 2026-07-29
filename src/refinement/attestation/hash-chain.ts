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
  return createHash('sha256')
    .update(prevHash ?? 'genesis')
    .update(JSON.stringify(payload))
    .digest('hex');
}
