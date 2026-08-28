/**
 * Custom recognizers for span types Presidio does not produce natively:
 * AGE and SECRET (code-review gap #3). Without these, under
 * DETECTOR=presidio the minor-author check (E.2.6), age generalisation
 * (G2), and the live-secret backstop (EXC_LIVE_SECRET) would silently
 * never fire.
 *
 * The rules are the same ones the mock detector uses — the parity spec
 * asserts both detectors agree on these two types over the adversarial
 * corpus.
 */
import { DetectedSpan } from '../refinement.types';

type Rule = { type: string; regex: RegExp; confidence: number; group?: number };

export const CUSTOM_RULES: Rule[] = [
  {
    type: 'SECRET',
    regex: /\b(?:sk|pk)_[A-Za-z0-9]{20,}\b/g,
    confidence: 0.95,
  },
  { type: 'SECRET', regex: /\bAKIA[0-9A-Z]{16}\b/g, confidence: 0.95 },
  {
    type: 'SECRET',
    regex:
      /\b(?:password|passcode|api key|secret key|private key|access token)\s+is\s+\S+/gi,
    confidence: 0.9,
  },
  {
    type: 'AGE',
    regex: /\b(?:i'?m|i am)\s+(\d{1,2})\b(?!\d)/gi,
    confidence: 0.9,
    group: 1,
  },
  {
    type: 'AGE',
    regex: /\b(\d{1,2})[- ]year[- ]old\b/gi,
    confidence: 0.9,
    group: 1,
  },
];

export function detectAgeAndSecrets(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = [];
  CUSTOM_RULES.forEach((rule) => {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = rule.group ? match[rule.group] : match[0];
      const offset = rule.group ? match[0].indexOf(value) : 0;
      spans.push({
        type: rule.type,
        start: match.index + offset,
        end: match.index + offset + value.length,
        text: value,
        confidence: rule.confidence,
      });
    }
  });
  return spans;
}
