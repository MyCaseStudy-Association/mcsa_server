/**
 * THE shared keyword-matching semantics (Stage 8 tracker §8.1): word-boundary,
 * case-insensitive, spaces in a keyword match any whitespace run. The app's
 * domain tagger and on-device brief matcher (mcsa sources/services/
 * keyword-match.ts) and this server-side QA gate must agree exactly, so
 * device-match and server-QA can never drift. The repos cannot share code;
 * both test suites run the same vectors instead. Change one, change both.
 *
 * Pure; deterministic; $0/record (D-26).
 */
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word boundaries are Unicode-aware: letters and digits from any script
 * count as word characters, so "résumé" matches at a boundary. No
 * lookbehind (kept identical to the Hermes-safe app pattern).
 */
export function keywordPattern(keyword: string): RegExp {
  const body = escapeRegex(keyword.trim()).replace(/ /g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
}

export const matchesKeyword = (text: string, keyword: string): boolean =>
  keyword.trim().length > 0 && keywordPattern(keyword).test(text);
