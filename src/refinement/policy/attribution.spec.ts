import { attributeSentence, effectiveBucket } from './attribution';

describe('attribution buckets (E.4.2)', () => {
  it('first-person possessive + relation → third_party', () => {
    const result = attributeSentence('my sister Sarah was at the park', true);
    expect(result.bucket).toBe('third_party');
  });

  it('first-person self-reference → self', () => {
    const result = attributeSentence('I was thinking about a new job', false);
    expect(result.bucket).toBe('self');
  });

  it('strong fiction framing → fiction (strong)', () => {
    const result = attributeSentence(
      'Write a story where a character named Sarah has cancer',
      true,
    );
    expect(result.bucket).toBe('fiction');
    expect(result.fictionTier).toBe('strong');
    expect(effectiveBucket(result)).toBe('fiction');
  });

  it('medium/weak fiction does NOT recover — effective bucket ambiguous', () => {
    const medium = attributeSentence(
      'Imagine someone named Sarah has cancer',
      true,
    );
    expect(medium.bucket).toBe('fiction');
    expect(medium.fictionTier).toBe('medium');
    expect(effectiveBucket(medium)).toBe('ambiguous');
  });

  it('bare third-person name → ambiguous (fail closed)', () => {
    const result = attributeSentence('Sarah has cancer', true);
    expect(result.bucket).toBe('ambiguous');
  });

  it('no person reference at all → unattributed (facts stay facts)', () => {
    const result = attributeSentence(
      'The Catholic Church was founded centuries ago',
      false,
    );
    expect(result.bucket).toBe('unattributed');
  });

  it('PRECEDENCE: personal markers beat fiction, always (E.4.3)', () => {
    const result = attributeSentence(
      'Write a story where my sister gets diagnosed with cancer',
      false,
    );
    expect(result.bucket).toBe('third_party');
  });

  it('"in my novel" is fiction, not self', () => {
    const result = attributeSentence(
      'In my novel a detective solves the case',
      false,
    );
    expect(result.bucket).toBe('fiction');
    expect(result.fictionTier).toBe('strong');
  });
});
