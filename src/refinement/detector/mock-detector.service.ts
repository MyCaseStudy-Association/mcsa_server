/**
 * Deterministic regex/heuristic detector for development and tests.
 * NOT a production detector — swap for Presidio (DETECTOR=presidio) before
 * any real data flows. Same interface, so the policy layer is untouched
 * (the model is swappable; the policy is not).
 */
import { Injectable } from '@nestjs/common';
import { DetectedSpan, Detector } from '../refinement.types';
import { CITY_TO_REGION, COUNTRIES, REGIONS } from '../policy/geo';

type Rule = { type: string; regex: RegExp; confidence: number; group?: number };

const RULES: Rule[] = [
  {
    type: 'EMAIL',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    confidence: 0.95,
  },
  {
    type: 'PHONE',
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    confidence: 0.85,
  },
  { type: 'GOV_ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.9 },
  { type: 'ACCOUNT', regex: /\b(?:\d[ -]?){13,19}\b/g, confidence: 0.7 },
  {
    type: 'IP',
    regex:
      /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    confidence: 0.9,
  },
  { type: 'URL', regex: /\bhttps?:\/\/[^\s]+/gi, confidence: 0.95 },
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
    type: 'DATE',
    regex: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g,
    confidence: 0.85,
  },
  {
    type: 'DATE',
    regex:
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/gi,
    confidence: 0.8,
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
  {
    type: 'NORP',
    regex:
      /\b(catholic|christian|muslim|jewish|hindu|buddhist|sikh|atheist|republican|democrat)\b/gi,
    confidence: 0.8,
  },
];

const FIRST_NAMES = new Set([
  'sarah',
  'john',
  'emma',
  'michael',
  'david',
  'maria',
  'james',
  'jennifer',
  'robert',
  'linda',
  'napoleon',
  'cleopatra',
  'batman',
  'superman',
]);

const SENTENCE_STARTERS = new Set([
  'the',
  'a',
  'an',
  'i',
  'my',
  'we',
  'write',
  'tell',
  'how',
  'what',
  'when',
  'where',
  'why',
  'who',
  'is',
  'are',
  'can',
  'could',
  'please',
  'imagine',
  'suppose',
  'in',
  'for',
  'on',
  'at',
  'this',
  'that',
]);

@Injectable()
export class MockDetectorService implements Detector {
  readonly id = 'mock-regex-detector';
  readonly version = '0.1';

  analyze(text: string): Promise<DetectedSpan[]> {
    const spans: DetectedSpan[] = [];

    RULES.forEach((rule) => {
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

    spans.push(...this.findPersonsAndPlaces(text));
    return Promise.resolve(spans);
  }

  /** Capitalised-sequence heuristic: known geo names → GPE, rest → PERSON. */
  private findPersonsAndPlaces(text: string): DetectedSpan[] {
    const spans: DetectedSpan[] = [];
    const capitalised = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let match: RegExpExecArray | null;

    while ((match = capitalised.exec(text)) !== null) {
      const value = match[0];
      const normalized = value.toLowerCase();

      if (
        CITY_TO_REGION[normalized] ||
        REGIONS.has(normalized) ||
        COUNTRIES.has(normalized)
      ) {
        spans.push({
          type: 'GPE',
          start: match.index,
          end: match.index + value.length,
          text: value,
          confidence: 0.85,
        });
        continue;
      }

      const words = value.split(/\s+/);
      const isMultiWordName = words.length >= 2 && words.length <= 3;
      const isKnownFirstName = FIRST_NAMES.has(normalized);
      const startsWithStopword = SENTENCE_STARTERS.has(words[0].toLowerCase());

      if ((isMultiWordName && !startsWithStopword) || isKnownFirstName) {
        spans.push({
          type: 'PERSON',
          start: match.index,
          end: match.index + value.length,
          text: value,
          confidence: 0.6,
        });
      }
    }
    return spans;
  }
}
