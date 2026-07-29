/**
 * Adversarial corpus (spec §E.6 tier 3) + boundary assertions.
 * These cases are the spec's own canonical examples — a failure here is a
 * policy regression, not a flaky test.
 */
import { MockDetectorService } from '../detector/mock-detector.service';
import { processRecord, PipelineVersions } from './pipeline';
import { RecordInput } from '../refinement.types';

const detector = new MockDetectorService();

const VERSIONS: PipelineVersions = {
  stage4RulesetVersion: '0.5-draft',
  modelId: 'mock-regex-detector',
  modelVersion: '0.1',
};

async function run(text: string, flags: string[] = []) {
  const input: RecordInput = {
    clientRecordId: 'r1',
    refinedText: text,
    flaggedCategoryIds: flags,
    exactHash: 'a'.repeat(64),
    simHash: 'b'.repeat(16),
  };
  const spans = await detector.analyze(text);
  return processRecord(input, spans, VERSIONS);
}

describe('adversarial corpus — category × attribution matrix (E.4.6)', () => {
  it('third-party health → EXCLUDED', async () => {
    const outcome = await run('My sister Sarah was diagnosed with cancer.');
    expect(outcome.outcome).toBe('excluded');
    expect(outcome.reasonCodes).toContain('EXC_SPECIAL_CATEGORY');
    expect(outcome.attestation.third_party_data_present).toBe(true);
  });

  it('own health → EXCLUDED', async () => {
    const outcome = await run('I was diagnosed with cancer last spring.');
    expect(outcome.outcome).toBe('excluded');
    expect(outcome.reasonCodes).toContain('EXC_SPECIAL_CATEGORY');
  });

  it('strong fiction health → KEPT (recovered), names redacted', async () => {
    const outcome = await run(
      'Write a story where a character named Sarah has cancer and finds hope in a small coastal town.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.reasonCodes).toContain('FICTION_RECOVERED');
    expect(outcome.attestation.fiction_recovery_applied).toBe(true);
    expect(outcome.finalText).not.toContain('Sarah');
    expect(outcome.finalText).toContain('[PERSON_1]');
  });

  it('fiction + personal marker → EXCLUDED (the loophole, closed — E.4.3)', async () => {
    const outcome = await run(
      'Write a story where my sister gets diagnosed with cancer.',
    );
    expect(outcome.outcome).toBe('excluded');
    expect(outcome.reasonCodes).toContain('EXC_SPECIAL_CATEGORY');
  });

  it('bare-name health (ambiguous) → EXCLUDED by the APP-D-06 floor', async () => {
    const outcome = await run('Sarah has cancer.');
    expect(outcome.outcome).toBe('excluded');
    expect(outcome.reasonCodes).toContain('EXC_ATTRIBUTION_AMBIGUOUS');
  });

  it('squeaky door hinge → KEPT untouched (the APP-D-10 fix)', async () => {
    const outcome = await run(
      'What is the best treatment for a squeaky door hinge in an old wooden house?',
      ['health'],
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.finalText).toContain('treatment');
  });

  it('author is a minor → EXCLUDED + account review flag (E.2.6)', async () => {
    const outcome = await run(
      'I am 15 and I need help planning my homework schedule for the semester.',
    );
    expect(outcome.outcome).toBe('excluded');
    expect(outcome.reasonCodes).toContain('FLAG_ACCOUNT_REVIEW_MINOR');
  });

  it('live secret leaked past Stage 4 → EXCLUDED (backstop)', async () => {
    const outcome = await run(
      'Here is my key sk_abcdefghijklmnopqrstuvwxyz123456 for the integration.',
    );
    expect(outcome.outcome).toBe('excluded');
    expect(outcome.reasonCodes).toContain('EXC_LIVE_SECRET');
  });
});

describe('entity actions (E.1.3)', () => {
  it('identifiers redact at any confidence; record kept', async () => {
    const outcome = await run(
      'Please draft a polite reply to jane.doe@example.com about rescheduling our meeting to a later week this month.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.finalText).toContain('[EMAIL]');
    expect(outcome.finalText).not.toContain('jane.doe@example.com');
    expect(outcome.attestation.identifiers_redacted).toEqual(
      expect.arrayContaining([{ type: 'EMAIL', count: 1 }]),
    );
  });

  it('private person name → pseudonym; public figure → allowed, Q-ID logged', async () => {
    const outcome = await run(
      'Tell me what Napoleon Bonaparte did at Waterloo and explain the battle in simple terms for students.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.finalText).toContain('Napoleon');
    expect(outcome.attestation.gazetteer_allows).toContain('Q517');
    // The name must never appear in attestation or operator log fields
    // other than via Q-ID.
    const serialized = JSON.stringify(outcome.attestation);
    expect(serialized).not.toContain('Napoleon');
  });

  it('attribution override: "my friend Michael Jordan" → redacted despite gazetteer', async () => {
    const outcome = await run(
      'My friend Michael Jordan is coming to visit next month and we plan to tour the old city together.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.finalText).not.toContain('Michael Jordan');
    expect(outcome.finalText).toContain('[PERSON_1]');
    expect(outcome.attestation.gazetteer_allows).toHaveLength(0);
  });

  it('attributed city → generalised to province (geography ladder)', async () => {
    const outcome = await run(
      'I live in Winnipeg and I want restaurant recommendations for a quiet dinner with friends this weekend.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.finalText).not.toContain('Winnipeg');
    expect(outcome.finalText).toContain('Manitoba');
    expect(outcome.attestation.generalisations_applied).toContain(
      'city→province',
    );
  });

  it('unattributed geography stays untouched (facts about the world)', async () => {
    const outcome = await run(
      'Describe how Winnipeg compares to Toronto for winter tourism and what travellers should expect from each city.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.finalText).toContain('Winnipeg');
    expect(outcome.finalText).toContain('Toronto');
  });
});

describe('quasi-identifiers (E.3)', () => {
  it('singling-out check fires at ≥4 QI types and suppresses down to 3', async () => {
    const outcome = await run(
      'I am a 34-year-old female cardiologist in Winnipeg with three kids and I want advice on balancing long shifts with family life at home.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.attestation.singling_out_suppression.fired).toBe(true);
    expect(outcome.attestation.qi_count_after).toBeLessThanOrEqual(3);
    expect(outcome.reasonCodes).toContain('SUPPRESS_SINGLING_OUT');
    // Highest-ranked QI (exact age) is suppressed first.
    expect(
      outcome.attestation.singling_out_suppression.qi_types_suppressed,
    ).toContain('exact_age');
  });

  it('few QIs → no suppression', async () => {
    const outcome = await run(
      'I am a teacher and I want ideas for a fun geography lesson about rivers for my Tuesday class this term.',
    );
    expect(outcome.outcome).toBe('kept');
    expect(outcome.attestation.singling_out_suppression.fired).toBe(false);
  });
});

describe('quality ceilings (E.1.7)', () => {
  it('near-empty prompt → DROP_TOO_SHORT', async () => {
    const outcome = await run('email jane.doe@example.com now');
    expect(outcome.outcome).toBe('dropped');
    expect(outcome.reasonCodes).toContain('DROP_TOO_SHORT');
  });
});

describe('metadata-only boundary (E.1.8, INV-1)', () => {
  it('attestation and operator log never contain prompt content', async () => {
    const secretishText =
      'My friend Zebulon Quixote from Winnipeg emailed zebulon@example.com about the January 5, 2024 meeting agenda and notes.';
    const outcome = await run(secretishText);
    const persistedSurface = JSON.stringify({
      attestation: outcome.attestation,
      operatorLog: outcome.operatorLog,
    });
    expect(persistedSurface).not.toContain('Zebulon');
    expect(persistedSurface).not.toContain('zebulon@example.com');
    expect(persistedSurface).not.toContain('meeting agenda');
  });
});
