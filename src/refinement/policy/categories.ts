/**
 * Component (5b) input — server-side sensitive-category detection.
 *
 * MVP category "model": the same Appendix D v0.5 rule content as Stage 4,
 * evaluated per sentence with confidence shaped for the E.2 band:
 *  - exclude-tier hit (attribution-bearing pattern)      → 0.90 (certain)
 *  - flag-tier hit in a self/third-party sentence        → 0.65 (band → suppress)
 *  - flag-tier hit with no personal attribution          → 0.30 (ignored)
 *
 * This is deliberately swappable for a real classifier later — the matrix
 * (E.4.6) consuming these detections does not change.
 */
import { Sentence, SentenceAttribution } from '../refinement.types';

export const CATEGORY_RULES_VERSION = '0.5-draft';

type CategoryRule = {
  id: string;
  excludeKeywords?: string[];
  excludePatterns?: RegExp[];
  flagKeywords?: string[];
  flagPatterns?: RegExp[];
};

const SENSITIVE_CATEGORIES: CategoryRule[] = [
  {
    id: 'health',
    excludePatterns: [
      /\b(?:i (?:was|am|got|have|had)|i'?ve been|my)\s+(?:\w+\s+){0,2}(?:diagnos\w*|prescrib\w*|prescription|symptom\w*|medication|meds|therapist|psychiatrist|psychologist|condition|illness|disease|disorder|syndrome|cancer|tumou?r|diabet\w*|asthma|epilep\w*|hiv|aids|hepatitis|depress\w*|anxiety|bipolar|schizophren\w*|ptsd|adhd|ocd|anorexi\w*|bulimi\w*|addiction|rehab|chemo\w*|surgery|biopsy|treatment)\b/i,
      /\b(?:i'?m|i am|my (?:wife|partner|girlfriend|daughter|sister))\s+(?:\w+\s+){0,2}pregnant\b/i,
      /\bmy (?:pregnancy|miscarriage|abortion|fertility|ivf)\b/i,
      /\bmy (?:mother|father|mom|dad|sister|brother|son|daughter|wife|husband|partner|friend|colleague|coworker)\b[^.!?]{0,40}\b(?:diagnos\w*|cancer|depress\w*|anxiety|illness|disease|surgery|therapy|medication)\b/i,
      // Fiction-context health mention: a character "has/gets" a condition.
      // Low base severity; the matrix decides via attribution.
      /\b(?:has|gets|develops|suffers from|diagnosed with)\s+(?:\w+\s+)?(?:cancer|depression|anxiety|diabetes|schizophrenia|ptsd|hiv|aids|epilepsy)\b/i,
    ],
    excludeKeywords: [
      'self-harm',
      'selfharm',
      'suicidal',
      'suicide attempt',
      'overdosed',
    ],
    flagKeywords: [
      'treatment',
      'therapy',
      'therapist',
      'clinic',
      'hospital',
      'surgery',
      'disorder',
      'syndrome',
      'symptom',
      'symptoms',
      'diagnosis',
      'diagnosed',
      'medication',
      'dose',
      'dosage',
      'prescription',
      'vaccine',
      'immunization',
      'cancer',
      'tumor',
      'tumour',
      'diabetes',
      'asthma',
      'epilepsy',
      'hiv',
      'aids',
      'std',
      'sti',
      'hepatitis',
      'depression',
      'anxiety',
      'bipolar',
      'schizophrenia',
      'ptsd',
      'adhd',
      'ocd',
      'eating disorder',
      'anorexia',
      'bulimia',
      'pregnant',
      'pregnancy',
      'miscarriage',
      'abortion',
      'fertility',
      'ivf',
      'contraception',
      'chronic illness',
      'disability',
      'chemotherapy',
      'radiation',
      'biopsy',
      'mri',
      'ultrasound',
      'emergency room',
      'icu',
      'addiction',
      'rehab',
      'overdose',
      'mental health',
      'doctor',
      'nurse',
      'patient',
    ],
    flagPatterns: [/\b\d+\s?(?:mg|mcg|ml)\b/i],
  },
  {
    id: 'children',
    excludePatterns: [
      /\bi(?:'?m| am)\s*1[0-7]\b(?!\d)/i,
      /\bi(?:'?m| am)\s+(?:a\s+)?(?:minor|underage)\b/i,
      /\bmy (?:son|daughter|kid|child)\s+is\s+\d{1,2}\b/i,
      /\bin\s+\d{1,2}(?:st|nd|rd|th)\s+grade\b/i,
    ],
    flagKeywords: [
      'my son',
      'my daughter',
      'my kid',
      'my child',
      'my baby',
      'toddler',
      'kindergarten',
      'preschool',
      'elementary school',
      'middle school',
      'high school',
      'teenager',
    ],
  },
  {
    id: 'biometric',
    excludePatterns: [
      /\bmy\s+(?:fingerprint|thumbprint|faceprint|face scan|retina|retinal scan|iris scan|voiceprint|palm print|biometrics?)\b/i,
      /\bi\s+(?:scanned|registered|enrolled)\s+my\s+(?:face|fingerprint|iris|retina|voice)\b/i,
    ],
    flagKeywords: [
      'fingerprint',
      'thumbprint',
      'faceprint',
      'face scan',
      'facial recognition',
      'face id',
      'retina',
      'retinal scan',
      'iris scan',
      'voiceprint',
      'voice recognition',
      'biometric',
      'palm print',
      'hand geometry',
      'gait analysis',
    ],
  },
  {
    id: 'sexual_orientation_sex_life',
    excludeKeywords: [
      'my sexual orientation',
      'my sex life',
      'i am gay',
      "i'm gay",
      'i am a lesbian',
      "i'm a lesbian",
      'i am bisexual',
      "i'm bisexual",
      'i am asexual',
      "i'm asexual",
      'i am transgender',
      "i'm transgender",
      'i am trans',
      "i'm trans",
    ],
    flagKeywords: ['sexually active', 'sexual orientation', 'lgbtq'],
  },
  {
    id: 'race_ethnicity',
    excludeKeywords: [
      'my ethnicity',
      'my race is',
      'my heritage is',
      'my ancestry is',
    ],
    excludePatterns: [
      /\bas an?\s+(?:african[- ]american|black|white|asian|hispanic|latino|latina|latinx|indigenous|native american|arab|jewish|middle eastern)\s+(?:man|woman|person|guy|girl|american|canadian|immigrant)\b/i,
    ],
    flagKeywords: ['ethnicity', 'my background', 'my culture'],
  },
  {
    id: 'religion',
    excludeKeywords: [
      'my religion',
      'my faith is',
      'my church',
      'my mosque',
      'my synagogue',
      'my temple',
      'i pray to',
    ],
    excludePatterns: [
      /\bi(?:'?m| am)\s+(?:a\s+)?(?:practi[cs]ing\s+|observant\s+)?(?:christian|catholic|muslim|jewish|hindu|buddhist|sikh|atheist|agnostic|mormon|evangelical|orthodox)\b/i,
    ],
    flagKeywords: [
      'religion',
      'faith',
      'church',
      'mosque',
      'synagogue',
      'temple',
      'prayer',
    ],
  },
  {
    id: 'political_opinion',
    excludeKeywords: [
      'my political views',
      'my political opinion',
      'i voted for',
      'my party is',
    ],
    excludePatterns: [
      /\bi(?:'?m| am)\s+(?:a\s+)?(?:republican|democrat|conservative|liberal|progressive|socialist|libertarian|communist|anarchist)\b/i,
    ],
    flagKeywords: ['politics', 'election', 'political party', 'voted'],
  },
  {
    id: 'trade_union',
    excludeKeywords: [
      'my union',
      'i am a union member',
      "i'm a union member",
      'my shop steward',
    ],
    flagKeywords: [
      'union member',
      'shop steward',
      'collective bargaining',
      'labor union',
      'labour union',
      'trade union',
    ],
  },
  {
    id: 'genetic',
    excludeKeywords: [
      'my dna',
      'my genome',
      'my genetic test',
      'my dna test',
      'my 23andme',
      'my ancestry results',
    ],
    excludePatterns: [
      /\bi\s+(?:took|did|got)\s+(?:an?\s+)?(?:dna|genetic|ancestry)\s+test\b/i,
    ],
    flagKeywords: [
      'dna test',
      'genetic test',
      'genetic testing',
      'genome',
      'hereditary',
      '23andme',
      'ancestrydna',
      'genetic marker',
      'genetic predisposition',
      'brca',
    ],
  },
  {
    id: 'precise_geolocation',
    flagKeywords: [
      'i live at',
      'my address is',
      'my home address',
      'my neighbourhood',
      'my neighborhood',
    ],
  },
  {
    id: 'live_secret',
    excludeKeywords: ['seed phrase', 'recovery phrase', 'mnemonic phrase'],
    excludePatterns: [
      /\b(?:my |the )?(?:password|passcode|pin|api key|secret key|private key|access token|auth token)\s+is\b/i,
      /\b(?:sk|pk)_[A-Za-z0-9]{20,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
    ],
    flagKeywords: [
      'password',
      'passcode',
      'pin number',
      'routing number',
      'account number',
      'cvv',
      'security code',
      'api key',
      'secret key',
      'private key',
      'social security number',
      'credit card number',
      'access token',
    ],
  },
];

export type CategoryDetection = {
  categoryId: string;
  confidence: number;
  sentenceIndex: number;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordRegex(keyword: string) {
  const source = escapeRegex(keyword).replace(/ /g, '\\s+');
  return new RegExp(`(^|[^A-Za-z0-9])${source}(?=$|[^A-Za-z0-9])`, 'i');
}

function hits(text: string, keywords?: string[], patterns?: RegExp[]) {
  return Boolean(
    keywords?.some((keyword) => keywordRegex(keyword).test(text)) ||
    patterns?.some((pattern) => pattern.test(text)),
  );
}

export function detectCategories(
  sentences: Sentence[],
  attributions: SentenceAttribution[],
): CategoryDetection[] {
  const detections: CategoryDetection[] = [];

  sentences.forEach((sentence) => {
    const attribution = attributions[sentence.index];
    const personal =
      attribution.bucket === 'self' || attribution.bucket === 'third_party';

    SENSITIVE_CATEGORIES.forEach((category) => {
      if (
        hits(sentence.text, category.excludeKeywords, category.excludePatterns)
      ) {
        detections.push({
          categoryId: category.id,
          confidence: 0.9,
          sentenceIndex: sentence.index,
        });
        return;
      }
      if (hits(sentence.text, category.flagKeywords, category.flagPatterns)) {
        detections.push({
          categoryId: category.id,
          confidence: personal ? 0.65 : 0.3,
          sentenceIndex: sentence.index,
        });
      }
    });
  });

  return detections;
}
