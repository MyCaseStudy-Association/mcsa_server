/**
 * Cross-contributor duplicate check for the QA gate (Build #7, brief
 * `quality.dedupGuarantee`). Pure. Works on fingerprints only — the exact
 * SHA-256 and 64-bit SimHash the device computes from the normalised
 * original prompt (FR-2.3, D-23) — never on content.
 *
 * Rules (provisional, v0.1 — ED to ratify):
 *   - First come keeps: a prompt collides only with a fingerprint ANOTHER
 *     contributor submitted no later than this contributor did. The earlier
 *     submission stays `new`; the later one is the duplicate.
 *   - Exact collision = same exactHash. Near collision = different exactHash,
 *     SimHash Hamming distance <= NEAR_DUPLICATE_MAX_DISTANCE.
 *   - The sale unit is the conversation (APP-D-08), and short stock prompts
 *     ("thanks", "continue") collide across contributors constantly, so one
 *     colliding prompt does not make a conversation a duplicate. It is a
 *     duplicate when MORE than DUPLICATE_SHARE of its kept prompts collide.
 *     Exact outranks near.
 *
 * Same-contributor repeats are out of scope here: re-uploading a
 * conversation replaces its packaged bundle (one row per conversation).
 */
export const DEDUP_VERSION = '0.1';

/** SimHash bits that may differ for two prompts to count as near-duplicates. */
export const NEAR_DUPLICATE_MAX_DISTANCE = 3;

/** Share of a conversation's kept prompts that must collide. */
export const DUPLICATE_SHARE = 0.5;

export type DedupStatus = 'new' | 'exact_duplicate' | 'near_duplicate';

export type SeenFingerprint = {
  exactHash: string;
  simHash: string;
  seenAt: Date;
};

/** Hamming distance between two 64-bit SimHash hex strings. */
export function simHashDistance(left: string, right: string): number {
  let diff = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

/**
 * @param own    this conversation's kept prompts, as first seen from THIS contributor
 * @param others fingerprints from OTHER contributors (exact matches at least;
 *               every row when near-duplicate checking is wanted)
 */
export function classifyDuplicates(
  own: SeenFingerprint[],
  others: SeenFingerprint[],
): DedupStatus {
  if (own.length === 0) return 'new';

  let exact = 0;
  let near = 0;
  for (const prompt of own) {
    const earlier = others.filter(
      (other) => other.seenAt.getTime() <= prompt.seenAt.getTime(),
    );
    if (earlier.some((other) => other.exactHash === prompt.exactHash)) {
      exact += 1;
    } else if (
      earlier.some(
        (other) =>
          simHashDistance(other.simHash, prompt.simHash) <=
          NEAR_DUPLICATE_MAX_DISTANCE,
      )
    ) {
      near += 1;
    }
  }

  if (exact / own.length > DUPLICATE_SHARE) return 'exact_duplicate';
  if ((exact + near) / own.length > DUPLICATE_SHARE) return 'near_duplicate';
  return 'new';
}
