import { Sentence } from '../refinement.types';

/**
 * Sentence segmentation — the SUPPRESS unit (E.4.1). A run-on prompt with no
 * boundaries becomes one segment, so SUPPRESS collapses into losing the whole
 * text; that edge case is accepted by the spec.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const regex = /[^.!?\n]+[.!?]*/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    if (raw.trim().length === 0) continue;
    sentences.push({
      index,
      start: match.index,
      end: match.index + raw.length,
      text: raw,
    });
    index += 1;
  }

  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push({ index: 0, start: 0, end: text.length, text });
  }
  return sentences;
}

export function sentenceAt(sentences: Sentence[], offset: number): Sentence {
  const found = sentences.find(
    (sentence) => offset >= sentence.start && offset < sentence.end,
  );
  return found ?? sentences[sentences.length - 1];
}
