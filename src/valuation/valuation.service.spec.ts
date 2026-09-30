import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { EstimateRequestDto } from './dto/estimate-request.dto';
import { estimateRange } from './estimate';
import { preciseValue } from './precise-valuation';
import {
  ATTRITION_PERCENT,
  PRICING_CENTS,
  PRICING_SCHEDULE_VERSION,
  conversationCents,
} from './pricing-schedule';
import { tierCounts, tierOf, wordCount } from './tiers';
import { ValuationService } from './valuation.service';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

/**
 * Shared parity vectors — the app's tier counter runs these SAME cases
 * (mcsa_app sources/services). Change one side, change both.
 */
const WORD_COUNT_VECTORS: [string, number][] = [
  ['', 0],
  ['   ', 0],
  ['hello', 1],
  ['  fix   this\tbug\nplease  ', 4],
  ['email [EMAIL] to [PERSON_1] today', 5],
  ["don't split contractions", 3],
  ['naïve café résumé', 3],
];

describe('tiers', () => {
  it.each(WORD_COUNT_VECTORS)('wordCount(%j) = %i', (text, expected) => {
    expect(wordCount(text)).toBe(expected);
  });

  it('places the tier edges as ratified (10 and 50 are medium)', () => {
    expect(tierOf(words(9))).toBe('short');
    expect(tierOf(words(10))).toBe('medium');
    expect(tierOf(words(50))).toBe('medium');
    expect(tierOf(words(51))).toBe('long');
  });

  it('counts prompts per tier', () => {
    expect(tierCounts(['hi', words(12), words(60), 'ok'])).toEqual({
      short: 2,
      medium: 1,
      long: 1,
    });
  });
});

describe('pricing schedule', () => {
  it('is the ratified v0.1 schedule in integer cents', () => {
    expect(PRICING_SCHEDULE_VERSION).toBe('0.1');
    expect(PRICING_CENTS).toEqual({ short: 1, medium: 5, long: 10 });
    expect(ATTRITION_PERCENT).toBe(50);
    expect(conversationCents({ short: 1, medium: 4, long: 2 })).toBe(41);
  });
});

describe('estimateRange', () => {
  it('sums every conversation and halves for the low end', () => {
    expect(
      estimateRange([
        { short: 1, medium: 4, long: 2 }, // 41
        { short: 0, medium: 2, long: 0 }, // 10
      ]),
    ).toEqual({
      lowCents: 25, // floor(51 × 0.5) — rounds DOWN, never over-promises
      highCents: 51,
      currency: 'USD',
      scheduleVersion: '0.1',
    });
  });

  it('stays exact in integers where decimal dollars would drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; 10 + 20 === 30 in cents.
    const range = estimateRange([
      { short: 0, medium: 0, long: 1 },
      { short: 0, medium: 0, long: 2 },
    ]);
    expect(range.highCents).toBe(30);
    expect(Number.isInteger(range.lowCents)).toBe(true);
  });

  it('returns exactly the four contract fields — no rates, no split', () => {
    expect(
      Object.keys(estimateRange([{ short: 1, medium: 0, long: 0 }])).sort(),
    ).toEqual(['currency', 'highCents', 'lowCents', 'scheduleVersion']);
  });

  it('values zero-count conversations at $0', () => {
    expect(estimateRange([{ short: 0, medium: 0, long: 0 }])).toMatchObject({
      lowCents: 0,
      highCents: 0,
    });
  });
});

describe('preciseValue', () => {
  it('prices the final prompts once, with the schedule version', () => {
    expect(
      preciseValue(['hi', words(10), words(51), 'contact [PERSON_1] now']),
    ).toEqual({
      tierCounts: { short: 2, medium: 1, long: 1 },
      amountCents: 17,
      scheduleVersion: '0.1',
    });
  });
});

describe('ValuationService', () => {
  it('delegates to the pure estimate', () => {
    const conversations = [{ short: 3, medium: 1, long: 0 }];
    expect(new ValuationService().estimate({ conversations })).toEqual(
      estimateRange(conversations),
    );
  });
});

describe('EstimateRequestDto at the boundary (same options as main.ts)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: EstimateRequestDto });

  it('accepts tier counts', async () => {
    await expect(
      validate({ conversations: [{ short: 1, medium: 2, long: 3 }] }),
    ).resolves.toBeInstanceOf(EstimateRequestDto);
  });

  it.each([
    ['a conversation id', { conversationId: 'c1' }],
    ['prompt text', { text: 'hello' }],
  ])('rejects %s inside a conversation', async (_label, extra) => {
    await expect(
      validate({ conversations: [{ short: 1, medium: 0, long: 0, ...extra }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a brief ref at the top level', async () => {
    await expect(
      validate({
        briefRef: 'brief_x',
        conversations: [{ short: 1, medium: 0, long: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['empty list', { conversations: [] }],
    ['negative count', { conversations: [{ short: -1, medium: 0, long: 0 }] }],
    [
      'fractional count',
      { conversations: [{ short: 1.5, medium: 0, long: 0 }] },
    ],
    ['missing tier', { conversations: [{ short: 1, medium: 0 }] }],
  ])('rejects %s', async (_label, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
