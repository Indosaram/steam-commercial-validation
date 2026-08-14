/**
 * Decision-log records.
 *
 * One record per candidate per evaluation round: what was built, what is known
 * to be missing, what was decided, and why. `hold` is the only verdict the
 * foundation itself may use - promote/kill belong to the owner selection gate.
 */

import { getConcept } from './concepts.js';

export const DECISION_LOG_VERSION = 1;

/** Supported verdicts. Anything referencing publication is deliberately absent. */
export const DECISIONS = Object.freeze(['promote', 'revise', 'kill', 'hold']);

/**
 * @param {{session: object, decision: string, rationale: string,
 *          known_limitations?: string[], recorded_at?: string,
 *          scorecard_ref?: string|null}} args
 */
export function buildDecisionRecord({
  session,
  decision,
  rationale,
  known_limitations = [],
  recorded_at,
  scorecard_ref = null,
}) {
  if (!session || typeof session !== 'object') {
    throw new Error('buildDecisionRecord requires a finished session object');
  }
  getConcept(session.concept_id);

  if (!DECISIONS.includes(decision)) {
    throw new Error(
      `unsupported decision "${decision}"; expected one of: ${DECISIONS.join(', ')}`,
    );
  }
  if (typeof rationale !== 'string' || rationale.trim() === '') {
    throw new Error('decision record requires a non-empty rationale');
  }
  if (!Array.isArray(known_limitations)) {
    throw new Error('known_limitations must be an array of strings');
  }

  return {
    decision_log_version: DECISION_LOG_VERSION,
    concept_id: session.concept_id,
    build_id: session.build_id,
    session_id: session.session_id,
    recorded_at: recorded_at ?? null,
    decision,
    rationale,
    known_limitations: [...known_limitations],
    scorecard_ref,
  };
}

/** Render decision records as a Markdown decision log. */
export function renderDecisionLog(records, { title = 'Decision log' } = {}) {
  const header = ['concept_id', 'build_id', 'decision', 'rationale', 'known_limitations'];
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const body = records.map((r) =>
    line([
      r.concept_id,
      r.build_id,
      r.decision,
      r.rationale.replace(/\|/g, '\\|'),
      (r.known_limitations ?? []).join('; ').replace(/\|/g, '\\|') || '-',
    ]),
  );
  return [`# ${title}`, '', line(header), line(header.map(() => '---')), ...body, ''].join('\n');
}
