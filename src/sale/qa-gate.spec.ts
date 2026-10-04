import type { BriefQuality, BriefSpec } from '../briefs/briefs.types';
import { classifyDuplicates, simHashDistance } from './dedup';
import type { SeenFingerprint } from './dedup';
import { matchesKeyword } from './keyword-match';
import { qaGate, redactionDensity } from './qa-gate';
import type { QaBrief, QaCandidate } from './qa-gate';

/**
 * Shared keyword semantics. The SAME vectors run in the app
 * (sources/services/__tests__/brief-match.test.ts) — device match and
 * server QA must agree.
 */
const KEYWORD_VECTORS: [string, string, boolean][] = [
  ['Please DEBUG it', 'debug', true],
  ['the debugger', 'debug', false],
  ['a  stack   trace here', 'stack trace', true],
  ['rewrite my résumé please', 'résumé', true],
  ['résumés', 'résumé', false],
  ['anything', ' ', false],
];

describe('matchesKeyword (parity with the app)', () => {
  it.each(KEYWORD_VECTORS)('matchesKeyword(%j, %j) = %s', (text, kw, out) => {
    expect(matchesKeyword(text, kw)).toBe(out);
  });
});

const spec = (overrides: Partial<BriefSpec> = {}): BriefSpec => ({
  domains: ['coding'],
  languages: ['en'],
  keywordsAny: ['debug'],
  keywordsAll: [],
  keywordsNone: [],
  minPromptsPerConversation: 2,
  ...overrides,
});

const brief = (
  specOverrides: Partial<BriefSpec> = {},
  rest: Partial<Omit<QaBrief, 'spec'>> = {},
  quality: Partial<BriefQuality> = {},
): QaBrief => ({
  live: true,
  categoryId: 'ai_lab_commercial',
  spec: spec(specOverrides),
  quality: { maxRedactionDensity: 0.15, dedupGuarantee: 'exact', ...quality },
  ...rest,
});

const candidate = (overrides: Partial<QaCandidate> = {}): QaCandidate => ({
  finalPrompts: [
    'help me debug this python function please',
    'it throws when the list is empty, why',
  ],
  language: 'en',
  domainTags: ['coding'],
  dedupStatus: 'new',
  consent: {
    present: true,
    revoked: false,
    buyerCategories: ['ai_lab_commercial'],
    jurisdiction: 'US',
  },
  ...overrides,
});

describe('qaGate', () => {
  it('passes a clean, consented, matching conversation', () => {
    expect(qaGate(candidate(), brief())).toEqual({
      pass: true,
      failures: [],
      redactionDensity: 0,
    });
  });

  it('fails every precondition it can see, codes only', () => {
    const result = qaGate(
      candidate({
        finalPrompts: [],
        consent: {
          present: true,
          revoked: true,
          buyerCategories: ['academic'],
          jurisdiction: null,
        },
      }),
      brief({}, { live: false }),
    );
    expect(result.pass).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'QA_BRIEF_NOT_LIVE',
        'QA_NOT_PACKAGED',
        'QA_CONSENT_REVOKED',
        'QA_CATEGORY_NOT_CONSENTED',
        'QA_JURISDICTION',
        'QA_MIN_PROMPTS',
        'QA_REDACTION_DENSITY',
      ]),
    );
  });

  it('fails without a consent receipt', () => {
    const result = qaGate(
      candidate({
        consent: {
          present: false,
          revoked: false,
          buyerCategories: [],
          jurisdiction: null,
        },
      }),
      brief(),
    );
    expect(result.failures).toEqual(['QA_NO_CONSENT']);
  });

  it('fails closed on a non-English or undetermined verdict', () => {
    expect(qaGate(candidate({ language: 'other' }), brief()).failures).toEqual([
      'QA_LANGUAGE',
    ]);
    expect(qaGate(candidate({ language: 'und' }), brief()).failures).toEqual([
      'QA_LANGUAGE',
    ]);
  });

  it('uses the device domain tags', () => {
    expect(
      qaGate(candidate({ domainTags: ['general'] }), brief()).failures,
    ).toEqual(['QA_DOMAIN']);
    expect(
      qaGate(candidate({ domainTags: ['general'] }), brief({ domains: [] }))
        .pass,
    ).toBe(true);
  });

  it('checks keywords on the FINAL text — a redacted keyword fails', () => {
    const redacted = candidate({
      finalPrompts: ['ask [PERSON_1] about it', 'and also about the weather'],
    });
    const result = qaGate(
      redacted,
      brief({ keywordsAny: ['debug'] }, {}, { maxRedactionDensity: 1 }),
    );
    expect(result.failures).toEqual(['QA_KEYWORDS_ANY']);
  });

  it('applies keywords all / none', () => {
    expect(
      qaGate(candidate(), brief({ keywordsAll: ['debug', 'missing'] }))
        .failures,
    ).toEqual(['QA_KEYWORDS_ALL']);
    expect(
      qaGate(candidate(), brief({ keywordsNone: ['python'] })).failures,
    ).toEqual(['QA_KEYWORDS_NONE']);
  });

  it('enforces the redaction-density ceiling', () => {
    const heavy = candidate({
      finalPrompts: ['debug [PERSON_1] [EMAIL] now', 'call [PHONE] today ok'],
    });
    expect(qaGate(heavy, brief()).failures).toEqual(['QA_REDACTION_DENSITY']);
  });

  it('honours the dedup guarantee', () => {
    const exact = candidate({ dedupStatus: 'exact_duplicate' });
    const near = candidate({ dedupStatus: 'near_duplicate' });
    expect(qaGate(exact, brief()).failures).toEqual(['QA_DUPLICATE']);
    expect(qaGate(near, brief()).pass).toBe(true);
    expect(
      qaGate(near, brief({}, {}, { dedupGuarantee: 'exact+near' })).failures,
    ).toEqual(['QA_DUPLICATE']);
  });
});

describe('redactionDensity', () => {
  it('is placeholder tokens over all tokens; empty is 1', () => {
    expect(redactionDensity(['hi [PERSON_1]', 'a b'])).toBe(0.25);
    expect(redactionDensity([])).toBe(1);
  });
});

describe('dedup', () => {
  const t = (ms: number) => new Date(ms);
  const fp = (
    exactHash: string,
    simHash: string,
    at: number,
  ): SeenFingerprint => ({
    exactHash,
    simHash,
    seenAt: t(at),
  });

  it('counts SimHash bit differences', () => {
    expect(simHashDistance('0000000000000000', '000000000000000f')).toBe(4);
    expect(simHashDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });

  it('first come keeps: only EARLIER other-contributor prints collide', () => {
    const own = [
      fp('a', '0000000000000000', 100),
      fp('b', '00000000000000f0', 100),
    ];
    expect(classifyDuplicates(own, [fp('a', '0', 50), fp('b', '0', 50)])).toBe(
      'exact_duplicate',
    );
    expect(
      classifyDuplicates(own, [fp('a', '0', 500), fp('b', '0', 500)]),
    ).toBe('new');
  });

  it('one stock prompt in common does not make a duplicate', () => {
    const own = [
      fp('thanks', '1111111111111111', 100),
      fp('x', '2222222222222222', 100),
      fp('y', '4444444444444444', 100),
    ];
    expect(classifyDuplicates(own, [fp('thanks', '1111111111111111', 1)])).toBe(
      'new',
    );
  });

  it('near: SimHash within 3 bits, exact outranks near', () => {
    const own = [
      fp('a', '0000000000000000', 100),
      fp('b', 'ff00000000000000', 100),
    ];
    const others = [
      fp('z1', '0000000000000007', 10), // 3 bits from a
      fp('z2', 'ff0000000000000f', 10), // 4 bits from b — not near
    ];
    expect(classifyDuplicates(own, others)).toBe('new'); // 1 of 2 is not > half
    expect(
      classifyDuplicates(own, [...others, fp('z3', 'ff00000000000001', 10)]),
    ).toBe('near_duplicate');
    expect(classifyDuplicates(own, [fp('a', '0', 1), fp('b', '0', 1)])).toBe(
      'exact_duplicate',
    );
  });
});
