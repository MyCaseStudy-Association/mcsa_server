/**
 * Public-figure gazetteer (E.1.9, APP-D-07). Local lookup ONLY — internet
 * lookup is architecturally forbidden (it would push user content outside
 * the trust zone and add per-record API cost).
 *
 * SEED artefact for Phase 0 development. The production artefact is built
 * offline from Wikidata (CC0) with a sitelink-notability threshold and
 * disambiguation-page exclusion; this seed keeps the interface, the
 * versioning, and the fail-closed default in place.
 *
 * Constraints (ratified):
 *  1. Fail closed — a name not present here is a private individual.
 *  2. Attribution overrides — "my friend Michael Jordan" is REDACTED
 *     (enforced by the pipeline, which only consults the gazetteer for
 *     spans without personal attribution).
 *  3. Audit logs carry the Wikidata Q-ID, never the name (E.1.8).
 */
export const GAZETTEER_VERSION = 'seed-0.1';

export type GazetteerEntry = {
  qid: string;
  kind: 'public_figure' | 'fictional_character';
};

const ENTRIES: Record<string, GazetteerEntry> = {
  napoleon: { qid: 'Q517', kind: 'public_figure' },
  'napoleon bonaparte': { qid: 'Q517', kind: 'public_figure' },
  'albert einstein': { qid: 'Q937', kind: 'public_figure' },
  'michael jordan': { qid: 'Q41421', kind: 'public_figure' },
  'taylor swift': { qid: 'Q26876', kind: 'public_figure' },
  'barack obama': { qid: 'Q76', kind: 'public_figure' },
  'william shakespeare': { qid: 'Q692', kind: 'public_figure' },
  'marie curie': { qid: 'Q7186', kind: 'public_figure' },
  'isaac newton': { qid: 'Q935', kind: 'public_figure' },
  'abraham lincoln': { qid: 'Q91', kind: 'public_figure' },
  'winston churchill': { qid: 'Q8016', kind: 'public_figure' },
  cleopatra: { qid: 'Q635', kind: 'public_figure' },
  'julius caesar': { qid: 'Q1048', kind: 'public_figure' },
  'leonardo da vinci': { qid: 'Q762', kind: 'public_figure' },
  'elon musk': { qid: 'Q317521', kind: 'public_figure' },
  'sherlock holmes': { qid: 'Q4653', kind: 'fictional_character' },
  'harry potter': { qid: 'Q3244512', kind: 'fictional_character' },
  'darth vader': { qid: 'Q12206942', kind: 'fictional_character' },
  batman: { qid: 'Q2695156', kind: 'fictional_character' },
  superman: { qid: 'Q79015', kind: 'fictional_character' },
};

/** Fail-closed lookup: undefined means "treat as a private individual". */
export function lookupPublicFigure(name: string): GazetteerEntry | undefined {
  return ENTRIES[name.toLowerCase().replace(/\s+/g, ' ').trim()];
}
