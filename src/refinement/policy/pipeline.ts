/**
 * Stage 6 pipeline — the policy layer around the detector (spec §7.3.1,
 * Appendix E). Pure function: no I/O, no state, no clock. Runs entirely in
 * memory; the caller discards everything except the outcome + attestation
 * (INV-1).
 *
 * Order of operations is fixed by E.3.4:
 *   spans → attribution → entity→action mapping + thresholds →
 *   redact/generalise → singling-out check → final category exclusion →
 *   attestation.
 */
import {
  attributeSentence,
  attributeSpan,
  effectiveBucket,
} from './attribution';
import { detectCategories } from './categories';
import { GAZETTEER_VERSION, lookupPublicFigure } from './gazetteer';
import { classifyLocation, GEO_TABLE_VERSION } from './geo';
import { sentenceAt, splitSentences } from './sentences';
import {
  MAX_QI_TYPES,
  MIN_REAL_TOKENS,
  PII_DENSITY_EXCLUDE_COUNT,
  REDACTION_DENSITY_CEILING,
  STAGE6_POLICY_VERSION,
  THRESHOLDS,
  THRESHOLDS_VERSION,
} from './thresholds';
import {
  AttestationPayload,
  DetectedSpan,
  OperatorLogEntry,
  PipelineOutcome,
  RecordInput,
  SentenceAttribution,
} from '../refinement.types';

// ---------------------------------------------------------------------------
// Component (2) — entity → action mapping (E.1.3)
// ---------------------------------------------------------------------------

type EntityGroup =
  | 'identifier'
  | 'secret'
  | 'person'
  | 'org'
  | 'location'
  | 'date'
  | 'age'
  | 'norp'
  | 'benign'
  | 'unknown';

const IDENTIFIER_PLACEHOLDERS: Record<string, string> = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  GOV_ID: 'GOV_ID',
  ACCOUNT: 'ACCOUNT',
  IP: 'IP',
  URL: 'URL',
  HANDLE: 'HANDLE',
  POSTAL: 'POSTAL',
  GEO_COORD: 'GEO',
  ADDRESS: 'LOCATION',
  MEDICAL_LICENSE: 'ID',
};

const BENIGN_TYPES = new Set([
  'MONEY',
  'QUANTITY',
  'CARDINAL',
  'ORDINAL',
  'PERCENT',
  'EVENT',
  'WORK_OF_ART',
  'LAW',
  'LANGUAGE',
  'PRODUCT',
  'TIME',
]);

function groupOf(type: string): EntityGroup {
  if (type in IDENTIFIER_PLACEHOLDERS) return 'identifier';
  if (type === 'SECRET') return 'secret';
  if (type === 'PERSON') return 'person';
  if (type === 'ORG') return 'org';
  if (type === 'GPE' || type === 'LOC' || type === 'FAC') return 'location';
  if (type === 'DATE') return 'date';
  if (type === 'AGE') return 'age';
  if (type === 'NORP') return 'norp';
  if (BENIGN_TYPES.has(type)) return 'benign';
  return 'unknown'; // group H — fail closed: REDACT + log
}

const EMPLOYER_MARKER =
  /\b(?:i work (?:at|for)|my (?:company|employer|firm|startup)|i(?:'m| am) (?:employed (?:at|by)|working at))\b/i;

const OCCUPATION_SELF =
  /\bi(?:'?m| am)\s+(?:a\s+|an\s+)?(?:\d{1,2}[- ]year[- ]old\s+)?(?:male\s+|female\s+)?(doctor|nurse|cardiologist|surgeon|teacher|professor|engineer|developer|lawyer|accountant|pilot|dentist|pharmacist|electrician|plumber|firefighter|police officer|scientist|architect|therapist|veterinarian|paramedic|librarian)\b/i;

const FAMILY_STRUCTURE =
  /\b(?:with|have|has|raising)\s+(?:one|two|three|four|five|\d+)\s+(?:kids?|children)\b/i;

const GENDER_SELF =
  /\bi(?:'?m| am)\s+(?:a\s+)?(?:\d{1,2}[- ]year[- ]old\s+)?(male|female|man|woman|non-binary)\b/i;

const AGE_ADJECTIVE = /\b(\d{1,2})[- ]year[- ]old\b/i;

// ---------------------------------------------------------------------------
// Internal working structures
// ---------------------------------------------------------------------------

type Edit = { start: number; end: number; replacement: string };

type QiHit = {
  type:
    | 'exact_age'
    | 'occupation'
    | 'employer'
    | 'family_structure'
    | 'gender'
    | 'geo';
  /** Range to redact if the singling-out check suppresses this QI. */
  start: number;
  end: number;
  placeholder: string;
};

/** Suppression rank (E.3.3) — most distinctive first. */
const QI_SUPPRESSION_ORDER: QiHit['type'][] = [
  'exact_age',
  'occupation',
  'employer',
  'family_structure',
  'gender',
  'geo',
];

const PLACEHOLDER_TOKEN = /^\[[A-Z_0-9]+\]$/;

function dedupeSpans(spans: DetectedSpan[]): DetectedSpan[] {
  const sorted = [...spans].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const result: DetectedSpan[] = [];
  let lastEnd = -1;
  sorted.forEach((span) => {
    if (span.start < lastEnd) return; // overlap — keep the earlier/longer span
    result.push(span);
    lastEnd = span.end;
  });
  return result;
}

function extractYear(text: string): string | null {
  const match = text.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export type PipelineVersions = {
  stage4RulesetVersion: string;
  modelId: string;
  modelVersion: string;
};

export function processRecord(
  input: RecordInput,
  spans: DetectedSpan[],
  versions: PipelineVersions,
): PipelineOutcome {
  const text = input.refinedText;
  const sentences = splitSentences(text);
  const cleanSpans = dedupeSpans(
    spans.filter(
      (span) =>
        span.start >= 0 && span.end <= text.length && span.end > span.start,
    ),
  );

  const reasonCodes = new Set<string>();
  const operatorLog: OperatorLogEntry[] = [];
  const actionsTaken = new Set<string>();
  const identifiersRedacted = new Map<string, number>();
  const generalisations = new Set<string>();
  const bucketsFired = new Set<string>();
  const gazetteerAllows = new Set<string>();
  const categoriesScreened = new Set<string>();
  let fictionRecoveryApplied = false;

  const log = (entry: OperatorLogEntry) => operatorLog.push(entry);

  // --- Step 2 (E.3.4): attribution per sentence -------------------------
  const personSentences = new Set(
    cleanSpans
      .filter((span) => groupOf(span.type) === 'person')
      .map((span) => sentenceAt(sentences, span.start).index),
  );
  const attributions: SentenceAttribution[] = sentences.map((sentence) =>
    attributeSentence(sentence.text, personSentences.has(sentence.index)),
  );

  const spanAttribution = (span: DetectedSpan): SentenceAttribution => {
    const sentence = sentenceAt(sentences, span.start);
    return attributeSpan(span, sentence, attributions[sentence.index], text);
  };

  const buildAttestation = (
    categoryOutcome: AttestationPayload['category_outcome'],
  ): AttestationPayload => ({
    record_fingerprint: input.exactHash,
    consent_receipt_ref: null,
    stage4_ruleset_version: versions.stage4RulesetVersion,
    stage6_policy_version: STAGE6_POLICY_VERSION,
    thresholds_version: THRESHOLDS_VERSION,
    model_id: versions.modelId,
    model_version: versions.modelVersion,
    gazetteer_version: `${GAZETTEER_VERSION}+geo:${GEO_TABLE_VERSION}`,
    identifiers_redacted: [...identifiersRedacted.entries()].map(
      ([type, count]) => ({ type, count }),
    ),
    generalisations_applied: [...generalisations],
    qi_count_before: qiCountBefore,
    qi_count_after: qiCountAfter,
    singling_out_suppression: {
      fired: singlingOutFired,
      qi_types_suppressed: suppressedQiTypes,
    },
    attribution_buckets_fired: [...bucketsFired],
    third_party_data_present: bucketsFired.has('third_party'),
    fiction_recovery_applied: fictionRecoveryApplied,
    gazetteer_allows: [...gazetteerAllows],
    categories_flagged_stage4: input.flaggedCategoryIds,
    categories_screened_stage6: [...categoriesScreened],
    category_outcome: categoryOutcome,
    actions_taken: [...actionsTaken],
    reason_codes: [...reasonCodes],
    standard: 'de-identified for the buyer; pseudonymised internally',
  });

  let qiCountBefore = 0;
  let qiCountAfter = 0;
  let singlingOutFired = false;
  let suppressedQiTypes: string[] = [];

  const exclude = (code: string): PipelineOutcome => {
    reasonCodes.add(code);
    actionsTaken.add('EXCLUDE');
    return {
      clientRecordId: input.clientRecordId,
      outcome: 'excluded',
      reasonCodes: [...reasonCodes],
      finalText: null,
      attestation: buildAttestation('excluded'),
      operatorLog,
    };
  };

  // --- EXCLUDE gates that need no text edits ----------------------------

  // Live secrets: a security problem, often unlocatable → whole record goes
  // (E.1.6 carve-out).
  const secretSpan = cleanSpans.find((span) => groupOf(span.type) === 'secret');
  if (secretSpan) {
    log({
      entityType: 'SECRET',
      action: 'EXCLUDE',
      confidence: secretSpan.confidence,
      start: secretSpan.start,
      end: secretSpan.end,
      detail: 'EXC_LIVE_SECRET',
    });
    return exclude('EXC_LIVE_SECRET');
  }

  // PII-density: detector-recall compounding (E.1.6). Absolute count.
  const identifierSpans = cleanSpans.filter(
    (span) => groupOf(span.type) === 'identifier',
  );
  if (identifierSpans.length >= PII_DENSITY_EXCLUDE_COUNT) {
    return exclude('EXC_PII_DENSITY');
  }

  // Author-is-a-minor: an ACCOUNT problem, not just a record problem
  // (E.2.6) — exclude the record AND surface the account-review flag.
  for (const span of cleanSpans.filter(
    (span) => groupOf(span.type) === 'age',
  )) {
    const age = Number.parseInt(span.text.replace(/\D/g, ''), 10);
    const attribution = spanAttribution(span);
    if (
      Number.isFinite(age) &&
      age < 18 &&
      effectiveBucket(attribution) === 'self'
    ) {
      reasonCodes.add('FLAG_ACCOUNT_REVIEW_MINOR');
      categoriesScreened.add('children');
      return exclude('EXC_SPECIAL_CATEGORY');
    }
  }

  // --- Final category screen (component 5b, matrix E.4.6) ---------------
  const detections = detectCategories(sentences, attributions);
  const suppressedSentences = new Set<number>();

  for (const detection of detections) {
    categoriesScreened.add(detection.categoryId);
    const attribution = attributions[detection.sentenceIndex];
    const bucket = effectiveBucket(attribution);
    bucketsFired.add(attribution.bucket);

    if (detection.confidence >= THRESHOLDS.category_exclude) {
      if (
        bucket === 'fiction' &&
        attribution.confidence >= THRESHOLDS.allow_fiction
      ) {
        fictionRecoveryApplied = true;
        reasonCodes.add('FICTION_RECOVERED');
        continue;
      }
      if (bucket === 'self' || bucket === 'third_party') {
        return exclude('EXC_SPECIAL_CATEGORY');
      }
      if (bucket === 'ambiguous') {
        // The APP-D-06 floor: confident category, unsure whose → exclude.
        reasonCodes.add('ATTR_AMBIGUOUS');
        return exclude('EXC_ATTRIBUTION_AMBIGUOUS');
      }
      // unattributed: no identifiable person in the sentence — a fact about
      // the world ("describe how chemotherapy works"). Keep.
      continue;
    }

    if (detection.confidence >= THRESHOLDS.category_suppress) {
      if (bucket === 'fiction') continue;
      if (bucket === 'unattributed') continue;
      suppressedSentences.add(detection.sentenceIndex);
      actionsTaken.add('SUPPRESS');
      log({
        entityType: `CATEGORY:${detection.categoryId}`,
        action: 'SUPPRESS',
        confidence: detection.confidence,
        start: sentences[detection.sentenceIndex].start,
        end: sentences[detection.sentenceIndex].end,
      });
    }
  }

  // NORP spans (E.1.3-F): sensitive-group membership attributed to an
  // identifiable person is special-category data.
  for (const span of cleanSpans.filter(
    (span) => groupOf(span.type) === 'norp',
  )) {
    const attribution = spanAttribution(span);
    const bucket = effectiveBucket(attribution);
    bucketsFired.add(attribution.bucket);
    categoriesScreened.add('norp_group');
    if (bucket === 'unattributed' || bucket === 'fiction') continue;
    if (span.confidence >= THRESHOLDS.category_exclude) {
      if (bucket === 'ambiguous') {
        reasonCodes.add('ATTR_AMBIGUOUS');
        return exclude('EXC_ATTRIBUTION_AMBIGUOUS');
      }
      return exclude('EXC_SPECIAL_CATEGORY');
    }
    if (span.confidence >= THRESHOLDS.category_suppress) {
      suppressedSentences.add(sentenceAt(sentences, span.start).index);
      actionsTaken.add('SUPPRESS');
    }
  }

  // --- Steps 3–4: entity actions (components 2 + 3 + 4) ------------------
  const edits: Edit[] = [];
  const qiHits: QiHit[] = [];
  const personPseudonyms = new Map<string, number>();

  const addEdit = (span: DetectedSpan, replacement: string, action: string) => {
    edits.push({ start: span.start, end: span.end, replacement });
    actionsTaken.add(action);
    log({
      entityType: span.type,
      action,
      confidence: span.confidence,
      start: span.start,
      end: span.end,
    });
  };

  for (const span of cleanSpans) {
    const group = groupOf(span.type);
    const attribution = spanAttribution(span);
    const bucket = effectiveBucket(attribution);
    // Fail-closed rule (E.1.2): ambiguous attribution acts like "attributed".
    const attributed =
      bucket === 'self' || bucket === 'third_party' || bucket === 'ambiguous';
    if (bucket === 'self' || bucket === 'third_party') {
      bucketsFired.add(bucket);
    }

    switch (group) {
      case 'identifier': {
        // Threshold 0.00 — act on any detection (E.2.2).
        const placeholder = IDENTIFIER_PLACEHOLDERS[span.type];
        addEdit(span, `[${placeholder}]`, 'REDACT');
        identifiersRedacted.set(
          span.type,
          (identifiersRedacted.get(span.type) ?? 0) + 1,
        );
        if (span.type === 'GOV_ID') reasonCodes.add('FLAG_GOV_ID');
        if (span.type === 'ACCOUNT') reasonCodes.add('FLAG_FINANCIAL');
        break;
      }

      case 'person': {
        if (span.confidence < THRESHOLDS.redact_person) break;
        // Gazetteer ALLOW only without personal attribution — private beats
        // famous (E.1.9). Fiction/unattributed/ambiguous-no-marker contexts
        // qualify; a relation marker forces redaction.
        const publicFigure = lookupPublicFigure(span.text);
        const hasRelationMarker = attribution.bucket === 'third_party';
        if (publicFigure && !hasRelationMarker) {
          gazetteerAllows.add(publicFigure.qid);
          actionsTaken.add('ALLOW');
          log({
            entityType: 'PERSON',
            action: 'ALLOW',
            confidence: span.confidence,
            start: span.start,
            end: span.end,
            detail: publicFigure.qid, // Q-ID, never the name (E.1.8)
          });
          break;
        }
        const key = span.text.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!personPseudonyms.has(key)) {
          personPseudonyms.set(key, personPseudonyms.size + 1);
        }
        addEdit(span, `[PERSON_${personPseudonyms.get(key)}]`, 'REDACT');
        break;
      }

      case 'location': {
        if (!attributed) break; // a fact about the world
        if (span.confidence < THRESHOLDS.generalise) break;
        if (bucket === 'ambiguous') reasonCodes.add('ATTR_AMBIGUOUS');
        const classified = classifyLocation(span.text);
        if (classified.granularity === 'country') break;
        if (classified.granularity === 'region') {
          qiHits.push({
            type: 'geo',
            start: span.start,
            end: span.end,
            placeholder: '[LOCATION]',
          });
          break;
        }
        if (classified.granularity === 'city' && classified.region) {
          addEdit(span, classified.region, 'GENERALISE');
          generalisations.add('city→province');
          qiHits.push({
            type: 'geo',
            start: span.start,
            end: span.end,
            placeholder: '[LOCATION]',
          });
          break;
        }
        addEdit(span, '[LOCATION]', 'REDACT');
        break;
      }

      case 'date': {
        if (!attributed) break;
        if (span.confidence < THRESHOLDS.generalise) break;
        const year = extractYear(span.text);
        addEdit(span, year ?? '[DATE]', year ? 'GENERALISE' : 'REDACT');
        if (year) generalisations.add('date→year');
        break;
      }

      case 'age': {
        const age = Number.parseInt(span.text.replace(/\D/g, ''), 10);
        if (!Number.isFinite(age) || !attributed) break;
        if (age >= 90) {
          addEdit(span, '90+', 'GENERALISE');
          generalisations.add('age→90+');
        } else {
          qiHits.push({
            type: 'exact_age',
            start: span.start,
            end: span.end,
            placeholder: '[AGE]',
          });
        }
        break;
      }

      case 'org': {
        const sentence = sentenceAt(sentences, span.start);
        if (
          EMPLOYER_MARKER.test(sentence.text) &&
          (bucket === 'self' || bucket === 'ambiguous')
        ) {
          addEdit(span, '[EMPLOYER]', 'REDACT');
          generalisations.add('employer→redacted');
          qiHits.push({
            type: 'employer',
            start: span.start,
            end: span.end,
            placeholder: '[EMPLOYER]',
          });
        }
        break;
      }

      case 'norp':
      case 'secret':
      case 'benign':
        break; // norp/secret handled above; benign allowed

      case 'unknown': {
        // Group H — the most important safety property: never let an
        // unrecognised entity type through silently.
        addEdit(span, '[REDACTED]', 'REDACT');
        reasonCodes.add('FLAG_UNKNOWN_ENTITY');
        log({
          entityType: span.type,
          action: 'REDACT',
          confidence: span.confidence,
          start: span.start,
          end: span.end,
          detail: 'FLAG_UNKNOWN_ENTITY',
        });
        break;
      }
    }
  }

  // --- Component (4): remaining QI detection (regex-based, self-attributed)
  const registerRegexQi = (
    pattern: RegExp,
    type: QiHit['type'],
    placeholder: string,
  ) => {
    const match = pattern.exec(text);
    if (!match) return;
    const sentence = sentenceAt(sentences, match.index);
    const attribution = attributions[sentence.index];
    if (attribution.bucket !== 'self' && attribution.bucket !== 'third_party') {
      return;
    }
    if (qiHits.some((hit) => hit.type === type)) return;
    qiHits.push({
      type,
      start: match.index,
      end: match.index + match[0].length,
      placeholder,
    });
  };

  registerRegexQi(OCCUPATION_SELF, 'occupation', '[OCCUPATION]');
  registerRegexQi(FAMILY_STRUCTURE, 'family_structure', '[FAMILY]');
  registerRegexQi(GENDER_SELF, 'gender', '[GENDER]');
  if (!qiHits.some((hit) => hit.type === 'exact_age')) {
    registerRegexQi(AGE_ADJECTIVE, 'exact_age', '[AGE]');
  }

  // --- Component (4): singling-out check (E.3.3) -------------------------
  const distinctQiTypes = [...new Set(qiHits.map((hit) => hit.type))];
  qiCountBefore = distinctQiTypes.length;
  qiCountAfter = qiCountBefore;

  if (qiCountBefore > MAX_QI_TYPES) {
    singlingOutFired = true;
    reasonCodes.add('SUPPRESS_SINGLING_OUT');
    actionsTaken.add('SUPPRESS');
    const toSuppress = QI_SUPPRESSION_ORDER.filter((type) =>
      distinctQiTypes.includes(type),
    ).slice(0, qiCountBefore - MAX_QI_TYPES);
    suppressedQiTypes = toSuppress;
    qiCountAfter = qiCountBefore - toSuppress.length;
    toSuppress.forEach((type) => {
      qiHits
        .filter((hit) => hit.type === type)
        .forEach((hit) => {
          edits.push({
            start: hit.start,
            end: hit.end,
            replacement: hit.placeholder,
          });
          log({
            entityType: `QI:${type}`,
            action: 'SUPPRESS',
            confidence: 1,
            start: hit.start,
            end: hit.end,
            detail: 'SUPPRESS_SINGLING_OUT',
          });
        });
    });
  }

  // --- Materialise the final text ---------------------------------------
  const finalText = materialise(text, sentences, suppressedSentences, edits);

  // --- Quality ceilings (E.1.7) — DROP, not EXCLUDE ----------------------
  const tokens = finalText.split(/\s+/).filter((token) => token.length > 0);
  const placeholderCount = tokens.filter((token) =>
    PLACEHOLDER_TOKEN.test(token),
  ).length;
  const realTokens = tokens.length - placeholderCount;

  const drop = (code: string): PipelineOutcome => {
    reasonCodes.add(code);
    return {
      clientRecordId: input.clientRecordId,
      outcome: 'dropped',
      reasonCodes: [...reasonCodes],
      finalText: null,
      attestation: buildAttestation(
        suppressedSentences.size > 0 ? 'suppressed' : 'none',
      ),
      operatorLog,
    };
  };

  if (realTokens < MIN_REAL_TOKENS) return drop('DROP_TOO_SHORT');
  if (
    tokens.length > 0 &&
    placeholderCount / tokens.length > REDACTION_DENSITY_CEILING
  ) {
    return drop('DROP_REDACTION_DENSITY');
  }

  return {
    clientRecordId: input.clientRecordId,
    outcome: 'kept',
    reasonCodes: [...reasonCodes],
    finalText,
    attestation: buildAttestation(
      suppressedSentences.size > 0 ? 'suppressed' : 'none',
    ),
    operatorLog,
  };
}

function materialise(
  text: string,
  sentences: { index: number; start: number; end: number }[],
  suppressedSentences: Set<number>,
  edits: Edit[],
): string {
  const sortedEdits = [...edits].sort(
    (left, right) => right.start - left.start,
  );
  let working = text;
  sortedEdits.forEach((edit) => {
    working =
      working.slice(0, edit.start) + edit.replacement + working.slice(edit.end);
  });

  if (suppressedSentences.size === 0) return working.trim();

  // Rebuild from sentence ranges, mapping original offsets through edits by
  // re-splitting the edited text — sentence boundaries (punctuation) are
  // never inside spans, so a re-split is safe.
  const editedSentences = splitSentences(working);
  return editedSentences
    .filter((sentence) => !suppressedSentences.has(sentence.index))
    .map((sentence) => sentence.text.trim())
    .join(' ')
    .trim();
}
