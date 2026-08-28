/**
 * Build #1 (conversation-scoped Stage 6) + Build #1b (conversation-wide
 * singling-out, APP-D-15) acceptance tests.
 */
import { MockDetectorService } from '../detector/mock-detector.service';
import { processConversation } from './conversation';
import { PipelineVersions } from './pipeline';
import { RecordInput } from '../refinement.types';

const detector = new MockDetectorService();

const VERSIONS: PipelineVersions = {
  stage4RulesetVersion: '0.5-draft',
  modelId: 'mock-regex-detector',
  modelVersion: '0.1',
};

function record(
  conversationId: string,
  turnIndex: number,
  text: string,
): RecordInput {
  return {
    clientRecordId: `${conversationId}:${turnIndex}`,
    conversationId,
    turnIndex,
    refinedText: text,
    flaggedCategoryIds: [],
    exactHash: 'a'.repeat(63) + String(turnIndex),
    simHash: 'b'.repeat(16),
  };
}

const analyze = (text: string) => detector.analyze(text);

describe('Build #1 — conversation-scoped pseudonyms', () => {
  it('same person → same pseudonym across all prompts of one conversation', async () => {
    const result = await processConversation(
      [
        record(
          'c1',
          0,
          'Sarah asked me about the plan for the road trip together.',
        ),
        record(
          'c1',
          1,
          'Draft the follow-up note so Sarah can review it tomorrow morning.',
        ),
      ],
      analyze,
      VERSIONS,
    );

    const texts = result.outcomes
      .filter((outcome) => outcome.outcome === 'kept')
      .map((outcome) => outcome.finalText);
    expect(texts).toHaveLength(2);
    texts.forEach((text) => {
      expect(text).toContain('[PERSON_1]');
      expect(text).not.toContain('Sarah');
    });
  });

  it('two people keep distinct, stable pseudonyms', async () => {
    const result = await processConversation(
      [
        record(
          'c1',
          0,
          'Sarah and Michael argued about the schedule for the offsite meeting and neither wants to compromise on the agenda.',
        ),
        record(
          'c1',
          1,
          'Write a short apology note from Michael to Sarah that smooths over the schedule mixup without assigning any blame.',
        ),
      ],
      analyze,
      VERSIONS,
    );

    const [first, second] = result.outcomes.map((outcome) => outcome.finalText);
    expect(first).toContain('[PERSON_1]');
    expect(first).toContain('[PERSON_2]');
    // Same mapping in the later prompt, regardless of mention order.
    expect(second).toContain('[PERSON_1]');
    expect(second).toContain('[PERSON_2]');
  });

  it('pseudonyms RESET at the conversation boundary', async () => {
    const conversationA = await processConversation(
      [
        record(
          'a',
          0,
          'Sarah asked me about the plan for the road trip together.',
        ),
      ],
      analyze,
      VERSIONS,
    );
    const conversationB = await processConversation(
      [
        record(
          'b',
          0,
          'Emma asked me about the plan for the road trip together.',
        ),
      ],
      analyze,
      VERSIONS,
    );
    // Both start over at [PERSON_1] — no cross-conversation linkable id.
    expect(conversationA.outcomes[0].finalText).toContain('[PERSON_1]');
    expect(conversationB.outcomes[0].finalText).toContain('[PERSON_1]');
  });

  it('outcomes stay ordered by turn_index with per-prompt exclusions as gaps', async () => {
    const result = await processConversation(
      [
        record(
          'c1',
          2,
          'Now summarise the whole discussion we had about gardening tools.',
        ),
        record(
          'c1',
          0,
          'Recommend some easy vegetables for a first garden this year.',
        ),
      ],
      analyze,
      VERSIONS,
    );
    expect(result.outcomes.map((outcome) => outcome.turnIndex)).toEqual([0, 2]);
  });

  it('detector failure fails closed per record', async () => {
    const failing = () => Promise.reject(new Error('down'));
    const result = await processConversation(
      [record('c1', 0, 'Recommend some easy vegetables for a first garden.')],
      failing,
      VERSIONS,
    );
    expect(result.outcomes[0].outcome).toBe('excluded');
    expect(result.outcomes[0].reasonCodes).toContain('EXC_STAGE6_UNAVAILABLE');
  });

  it('rework state never leaves the conversation step (INV-1 hygiene)', async () => {
    const result = await processConversation(
      [
        record(
          'c1',
          0,
          'Recommend some easy vegetables for a first garden this year.',
        ),
      ],
      analyze,
      VERSIONS,
    );
    result.outcomes.forEach((outcome) => {
      expect(outcome.rework).toBeUndefined();
    });
  });
});

describe('Build #1b — conversation-wide singling-out (APP-D-15)', () => {
  // Each prompt passes per-prompt Tier A (≤3 QI types) but the bundle
  // accumulates 5 distinct types → Tier B fires.
  const tierBPrompts = [
    // exact_age + occupation (2 types)
    'I am a 34-year-old teacher and I want lesson ideas for spring that keep the class engaged.',
    // geo (1 type)
    'I live in Toronto and I want recommendations for weekend hiking spots within a short drive.',
    // family_structure + gender (2 types)
    'I am a woman raising two kids and I need dinner ideas for busy weeknights that are quick and healthy.',
  ];

  it('Tier B suppresses across the bundle down to ≤ 4 distinct QI types', async () => {
    const result = await processConversation(
      tierBPrompts.map((text, index) => record('c1', index, text)),
      analyze,
      VERSIONS,
    );

    const suppressed = result.outcomes.flatMap(
      (outcome) =>
        outcome.attestation.singling_out_suppression.qi_types_suppressed,
    );
    expect(suppressed).toContain('exact_age'); // most distinctive present → first out
    const stillKept = result.outcomes.filter((o) => o.outcome === 'kept');
    expect(stillKept.length).toBeGreaterThan(0);
    stillKept.forEach((outcome) => {
      expect(outcome.finalText).not.toMatch(/34[- ]year[- ]old/);
    });
    result.outcomes.forEach((outcome) => {
      if (outcome.attestation.singling_out_suppression.fired) {
        expect(outcome.reasonCodes).toContain('SUPPRESS_SINGLING_OUT');
      }
    });
  });

  it('a bundle below the Tier B threshold is untouched', async () => {
    const result = await processConversation(
      [
        record(
          'c1',
          0,
          'I am a 34-year-old teacher and I want lesson ideas for spring classes.',
        ),
        record(
          'c1',
          1,
          'Suggest a reading list for the summer break that suits young readers.',
        ),
      ],
      analyze,
      VERSIONS,
    );
    result.outcomes.forEach((outcome) => {
      expect(
        outcome.attestation.singling_out_suppression.qi_types_suppressed,
      ).toEqual(expect.not.arrayContaining(['occupation']));
    });
  });

  it('gutting failover: suppression touching too many prompts → whole conversation EXCLUDED', async () => {
    // Bundle reaches 5 distinct QI types (Tier B) and the suppressed type
    // (exact_age) appears in EVERY prompt → touched ratio 1.0 > 0.4 → Tier C.
    const result = await processConversation(
      [
        record(
          'c1',
          0,
          'I am a 34-year-old teacher living in Toronto and I want lesson ideas that keep my class engaged in spring.',
        ),
        record(
          'c1',
          1,
          'I am a woman raising two kids and as a 34-year-old I need meal planning ideas that work for the whole week.',
        ),
      ],
      analyze,
      VERSIONS,
    );

    expect(
      result.outcomes.filter((outcome) => outcome.outcome === 'kept'),
    ).toHaveLength(0);
    expect(
      result.outcomes.some((outcome) =>
        outcome.reasonCodes.includes('EXC_SINGLING_OUT'),
      ),
    ).toBe(true);
  });
});
