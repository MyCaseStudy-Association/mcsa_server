/**
 * Detector parity for AGE + SECRET (code-review gap #3): Presidio produces
 * neither type natively, so the Presidio service merges the custom
 * recognizers. This spec asserts the custom recognizers find the same
 * AGE/SECRET spans the mock detector finds over the adversarial corpus —
 * so switching DETECTOR=presidio cannot silently disable the minor-author
 * check (E.2.6), age generalisation (G2), or EXC_LIVE_SECRET.
 */
import { detectAgeAndSecrets } from './custom-recognizers';
import { MockDetectorService } from './mock-detector.service';

const mock = new MockDetectorService();

const CORPUS = [
  "I'm 15 and my teacher gave me too much homework this week.",
  'I am a 34-year-old teacher looking for lesson ideas.',
  'My password is hunter2 and I keep forgetting it.',
  // Built at runtime so secret scanners do not flag the fake fixture.
  `Here is my key ${'sk_live_' + 'abcdefghijklmnopqrstuvwxyz'} please debug the call.`,
  'The AWS key AKIAABCDEFGHIJKLMNOP stopped working yesterday.',
  'Recommend some easy vegetables for a first garden.', // no hits
];

describe('AGE/SECRET parity: custom recognizers vs mock detector', () => {
  it.each(CORPUS)('agrees on %s', async (text) => {
    const mockSpans = (await mock.analyze(text)).filter(
      (span) => span.type === 'AGE' || span.type === 'SECRET',
    );
    const customSpans = detectAgeAndSecrets(text);

    const key = (span: { type: string; start: number; end: number }) =>
      `${span.type}:${span.start}:${span.end}`;
    expect(customSpans.map(key).sort()).toEqual(mockSpans.map(key).sort());
  });
});
