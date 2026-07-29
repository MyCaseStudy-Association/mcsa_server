/**
 * Component (5a) — attribution (Appendix E §E.4, APP-D-06 + APP-D-13).
 *
 * MVP = high-precision syntactic rules, NOT a coreference model. Computed
 * per sentence; a relation marker directly before an entity overrides the
 * sentence default ("my sister Sarah" → Sarah is third-party).
 *
 * Precedence (E.4.3): personal markers BEAT fiction, always — this closes
 * the "write a story where my sister…" loophole.
 */
import {
  AttributionBucket,
  DetectedSpan,
  FictionTier,
  Sentence,
  SentenceAttribution,
} from '../refinement.types';

export const THIRD_PARTY =
  /\bmy\s+(?:mother|mom|father|dad|parent|sister|brother|sibling|son|daughter|child|kid|wife|husband|spouse|partner|girlfriend|boyfriend|fianc[ée]e?|friend|colleague|co-?worker|boss|manager|employee|neighbou?r|roommate|flatmate|classmate|teacher|student|doctor|therapist|lawyer|accountant|client|patient|landlord|tenant|aunt|uncle|cousin|niece|nephew|grand(?:mother|father|ma|pa)|in-law)\b/i;

export const SELF =
  /\b(?:i|i'?m|i'?ve|i'?ll|i'?d|me|my|mine|myself|we|we'?re|we'?ve|us|our|ours)\b/i;

export const FICTION_STRONG: RegExp[] = [
  /\b(?:write|draft|compose|create|generate)\s+(?:me\s+)?(?:a|an|the)?\s*(?:short\s+)?(?:story|novel|screenplay|script|poem|fanfic|fan fiction|scene|chapter|dialogue|play)\b/i,
  /\b(?:in|for)\s+my\s+(?:story|novel|screenplay|script|book|game|campaign|d&d|dnd)\b/i,
  /\bfiction(?:al)?\s+(?:character|person|scenario|setting)\b/i,
];

export const FICTION_MEDIUM: RegExp[] = [
  /\b(?:imagine|suppose|hypothetically|let'?s say|what if|pretend)\b/i,
];

export const FICTION_WEAK = [
  'character',
  'plot',
  'protagonist',
  'antagonist',
  'narrative',
];

const FICTION_CONFIDENCE: Record<Exclude<FictionTier, null>, number> = {
  strong: 0.95,
  medium: 0.7,
  weak: 0.4,
};

function fictionTierOf(text: string): FictionTier {
  if (FICTION_STRONG.some((pattern) => pattern.test(text))) return 'strong';
  if (FICTION_MEDIUM.some((pattern) => pattern.test(text))) return 'medium';
  if (
    FICTION_WEAK.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text))
  ) {
    return 'weak';
  }
  return null;
}

/**
 * Attribution for one sentence. `hasPersonEntity` distinguishes bucket D
 * (bare third-person name → ambiguous, fail closed) from a sentence with no
 * person reference at all ("the Catholic Church was founded…" →
 * unattributed → facts about the world stay untouched, E.1.2).
 */
export function attributeSentence(
  sentenceText: string,
  hasPersonEntity: boolean,
): SentenceAttribution {
  // "my story/novel/book/game" is a fiction marker, not a personal one —
  // strip fiction phrases before testing personal markers so FICTION_STRONG's
  // own "my" does not read as self-attribution.
  const withoutFiction = FICTION_STRONG.reduce(
    (text, pattern) => text.replace(pattern, ' '),
    sentenceText,
  );

  // 1. Personal markers win over fiction, always (E.4.3).
  if (THIRD_PARTY.test(withoutFiction)) {
    return { bucket: 'third_party', confidence: 0.95, fictionTier: null };
  }
  if (SELF.test(withoutFiction)) {
    return { bucket: 'self', confidence: 0.95, fictionTier: null };
  }

  // 2. Fiction framing (tiered — only STRONG recovers records, E.4.4).
  const tier = fictionTierOf(sentenceText);
  if (tier) {
    return {
      bucket: 'fiction',
      confidence: FICTION_CONFIDENCE[tier],
      fictionTier: tier,
    };
  }

  // 3. Default: bare person mention → ambiguous (fail closed);
  //    no person at all → unattributed (a fact about the world).
  if (hasPersonEntity) {
    return { bucket: 'ambiguous', confidence: 0.5, fictionTier: null };
  }
  return { bucket: 'unattributed', confidence: 0.9, fictionTier: null };
}

/**
 * Per-span attribution: a relation marker directly preceding the entity
 * overrides the sentence bucket (E.4.1).
 */
export function attributeSpan(
  span: DetectedSpan,
  sentence: Sentence,
  sentenceAttribution: SentenceAttribution,
  fullText: string,
): SentenceAttribution {
  const windowStart = Math.max(sentence.start, span.start - 40);
  const before = fullText.slice(windowStart, span.start);
  const match = before.match(THIRD_PARTY);
  if (
    match &&
    windowStart + (match.index ?? 0) + match[0].length >= span.start - 2
  ) {
    return { bucket: 'third_party', confidence: 0.95, fictionTier: null };
  }
  return sentenceAttribution;
}

/**
 * The bucket the decision matrix (E.4.6) actually consumes: only STRONG
 * fiction keeps its recovery power; medium/weak fiction fails closed to
 * ambiguous.
 */
export function effectiveBucket(
  attribution: SentenceAttribution,
): AttributionBucket {
  if (attribution.bucket === 'fiction') {
    return attribution.fictionTier === 'strong' ? 'fiction' : 'ambiguous';
  }
  return attribution.bucket;
}
