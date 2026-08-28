/**
 * Conversation-wide singling-out / QI check (APP-D-15, Build #1b —
 * App. E §E.3.3). Even after per-prompt generalisation and the per-prompt
 * Tier A check, coarse attributes ACCUMULATED across a bundled conversation
 * can single out one person (the AOL-search-log problem).
 *
 *   Tier B: ≥ QI_CONVERSATION_SUPPRESS distinct QI types across the bundle
 *           → suppress most-distinctive-first down to ≤ QI_CONVERSATION_TARGET.
 *   Tier C: ≥ QI_CONVERSATION_EXCLUDE distinct types, or Tier B would gut
 *           the bundle → EXCLUDE the whole conversation.
 *
 * Honest limit (state to counsel): a heuristic, NOT formal k-anonymity.
 * Runs entirely in memory; consumes the in-memory `rework` state and strips
 * it before returning. Logs are metadata-only (QI type, never content).
 */
import {
  materialise,
  QI_SUPPRESSION_ORDER,
  qualityCeilingCode,
} from './pipeline';
import { splitSentences } from './sentences';
import {
  GUTTING_MAX_TOUCHED_RATIO,
  GUTTING_MIN_USABLE_PROMPTS,
  QI_CONVERSATION_EXCLUDE,
  QI_CONVERSATION_SUPPRESS,
  QI_CONVERSATION_TARGET,
} from './thresholds';
import {
  ConversationOutcome,
  PipelineOutcome,
  QiType,
} from '../refinement.types';

export function applyConversationSinglingOut(
  conversationId: string,
  outcomes: PipelineOutcome[],
): ConversationOutcome {
  const kept = outcomes.filter((outcome) => outcome.outcome === 'kept');

  // Distinct QI types across the whole bundle (Tier A already ran per prompt;
  // rework.qiHits carries only the survivors).
  const bundleQiTypes = new Set<QiType>(
    kept.flatMap((outcome) =>
      (outcome.rework?.qiHits ?? []).map((h) => h.type),
    ),
  );

  // Tier C fast path: irreducibly identifying bundle.
  if (bundleQiTypes.size >= QI_CONVERSATION_EXCLUDE) {
    return excludeConversation(conversationId, outcomes);
  }

  // Tier B: suppress most-distinctive-first until ≤ target.
  if (bundleQiTypes.size >= QI_CONVERSATION_SUPPRESS) {
    const toSuppress = QI_SUPPRESSION_ORDER.filter((type) =>
      bundleQiTypes.has(type),
    ).slice(0, bundleQiTypes.size - QI_CONVERSATION_TARGET);

    const touched = new Set<string>();
    for (const outcome of kept) {
      const rework = outcome.rework;
      if (!rework) continue;
      const hits = rework.qiHits.filter((hit) => toSuppress.includes(hit.type));
      if (hits.length === 0) continue;

      touched.add(outcome.clientRecordId);
      hits.forEach((hit) => {
        rework.edits.push({
          start: hit.start,
          end: hit.end,
          replacement: hit.placeholder,
        });
        outcome.operatorLog.push({
          entityType: `QI:${hit.type}`,
          action: 'SUPPRESS',
          confidence: 1,
          start: hit.start,
          end: hit.end,
          detail: 'SUPPRESS_SINGLING_OUT',
        });
      });

      // Re-materialise with the extra suppressions and re-check the E.1.7
      // ceilings — a prompt gutted by suppression drops on its own.
      const finalText = materialise(
        rework.text,
        splitSentences(rework.text),
        new Set(rework.suppressedSentences),
        rework.edits,
      );
      const ceilingCode = qualityCeilingCode(finalText);
      if (ceilingCode) {
        outcome.outcome = 'dropped';
        outcome.finalText = null;
        if (!outcome.reasonCodes.includes(ceilingCode)) {
          outcome.reasonCodes.push(ceilingCode);
        }
      } else {
        outcome.finalText = finalText;
      }

      // Attestation stays metadata-only: types + counts, never offsets+text.
      annotateSuppression(
        outcome,
        hits.map((hit) => hit.type),
      );
    }

    // Gutting check → fail over to Tier C (exclude the whole conversation).
    const usable = kept.filter((outcome) => outcome.outcome === 'kept').length;
    if (
      touched.size / kept.length > GUTTING_MAX_TOUCHED_RATIO ||
      usable < GUTTING_MIN_USABLE_PROMPTS
    ) {
      return excludeConversation(conversationId, outcomes);
    }
  }

  return { conversationId, outcomes: outcomes.map(stripRework) };
}

function annotateSuppression(outcome: PipelineOutcome, types: QiType[]) {
  const attestation = outcome.attestation;
  attestation.singling_out_suppression.fired = true;
  const suppressed = new Set(
    attestation.singling_out_suppression.qi_types_suppressed,
  );
  types.forEach((type) => suppressed.add(type));
  attestation.singling_out_suppression.qi_types_suppressed = [...suppressed];
  attestation.qi_count_after = Math.max(
    0,
    attestation.qi_count_after - new Set(types).size,
  );
  if (!attestation.reason_codes.includes('SUPPRESS_SINGLING_OUT')) {
    attestation.reason_codes.push('SUPPRESS_SINGLING_OUT');
  }
  if (!attestation.actions_taken.includes('SUPPRESS')) {
    attestation.actions_taken.push('SUPPRESS');
  }
  if (!outcome.reasonCodes.includes('SUPPRESS_SINGLING_OUT')) {
    outcome.reasonCodes.push('SUPPRESS_SINGLING_OUT');
  }
}

/** Tier C: every surviving prompt of the conversation is excluded. */
function excludeConversation(
  conversationId: string,
  outcomes: PipelineOutcome[],
): ConversationOutcome {
  const excluded = outcomes.map((outcome) => {
    if (outcome.outcome !== 'kept') return stripRework(outcome);
    outcome.outcome = 'excluded';
    outcome.finalText = null;
    if (!outcome.reasonCodes.includes('EXC_SINGLING_OUT')) {
      outcome.reasonCodes.push('EXC_SINGLING_OUT');
    }
    const attestation = outcome.attestation;
    attestation.category_outcome = 'excluded';
    if (!attestation.reason_codes.includes('EXC_SINGLING_OUT')) {
      attestation.reason_codes.push('EXC_SINGLING_OUT');
    }
    if (!attestation.actions_taken.includes('EXCLUDE')) {
      attestation.actions_taken.push('EXCLUDE');
    }
    outcome.operatorLog.push({
      entityType: 'CONVERSATION',
      action: 'EXCLUDE',
      confidence: 1,
      start: 0,
      end: 0,
      detail: 'EXC_SINGLING_OUT',
    });
    return stripRework(outcome);
  });
  return { conversationId, outcomes: excluded };
}

/** The in-memory rework state must not outlive this step (INV-1 hygiene). */
function stripRework(outcome: PipelineOutcome): PipelineOutcome {
  delete outcome.rework;
  return outcome;
}
