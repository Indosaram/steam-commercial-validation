/**
 * 1-5 owner scorecard export.
 *
 * The seven rating dimensions mirror the plan's Task 8 selection gate so the
 * foundation and the eventual owner-selection step speak the same language.
 * Every rating is an integer 1-5; anything else is rejected by dimension name.
 */

import { isConceptId, CONCEPT_IDS } from './concepts.js';
import { evaluateSuccessCondition } from './shell-core.js';

export const SCORECARD_VERSION = 1;

/** The seven fixed rating dimensions, in presentation order. */
export const RATING_DIMENSIONS = Object.freeze([
  'role_clarity',
  'first_payoff_timing',
  'repeated_action_satisfaction',
  'signature_reveal_memorability',
  'meaningful_choice',
  'next_scenario_desire',
  'five_to_ten_hour_potential',
]);

/**
 * Build a scorecard from a finished session plus owner ratings.
 * Ratings are taken verbatim - this function does not clamp or "fix" a bad
 * value, because a silently corrected score would corrupt the selection gate.
 *
 * @param {{session: object, ratings: Record<string, number>, notes?: string,
 *          stop_or_continue?: string, recorded_at?: string}} args
 */
export function buildScorecard({ session, ratings = {}, notes = '', stop_or_continue = '', recorded_at }) {
  if (!session || typeof session !== 'object') {
    throw new Error('buildScorecard requires a finished session object');
  }
  const success = evaluateSuccessCondition(session);
  return {
    scorecard_version: SCORECARD_VERSION,
    concept_id: session.concept_id,
    build_id: session.build_id,
    session_id: session.session_id,
    recorded_at: recorded_at ?? null,
    active_minutes: success.active_minutes,
    success_condition: success.checks,
    success_condition_met: success.ok,
    ratings: { ...ratings },
    notes,
    stop_or_continue,
  };
}

/**
 * Validate a scorecard export.
 * @param {unknown} card
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateScorecard(card) {
  const errors = [];

  if (card === null || typeof card !== 'object' || Array.isArray(card)) {
    return { ok: false, errors: ['scorecard must be a JSON object'] };
  }

  if (card.scorecard_version !== SCORECARD_VERSION) {
    errors.push(`scorecard_version must be ${SCORECARD_VERSION}`);
  }

  for (const field of ['concept_id', 'build_id', 'session_id']) {
    if (!card[field] || typeof card[field] !== 'string') {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (typeof card.concept_id === 'string' && !isConceptId(card.concept_id)) {
    errors.push(`invalid concept_id "${card.concept_id}"; expected one of: ${CONCEPT_IDS.join(', ')}`);
  }

  const ratings = card.ratings;
  if (ratings === null || typeof ratings !== 'object' || Array.isArray(ratings)) {
    errors.push('ratings must be a JSON object');
  } else {
    for (const dim of RATING_DIMENSIONS) {
      if (!Object.prototype.hasOwnProperty.call(ratings, dim)) {
        errors.push(`missing rating dimension: ${dim}`);
        continue;
      }
      const v = ratings[dim];
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        errors.push(`rating ${dim} must be an integer 1-5, got ${JSON.stringify(v)}`);
      }
    }
    for (const key of Object.keys(ratings)) {
      if (!RATING_DIMENSIONS.includes(key)) {
        errors.push(`unsupported rating dimension: ${key}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Render a set of scorecards as a comparison table (Markdown). */
export function renderComparisonTable(cards) {
  const header = ['concept_id', 'build_id', 'active_min', 'success', ...RATING_DIMENSIONS];
  const rows = cards.map((c) => [
    c.concept_id,
    c.build_id,
    String(c.active_minutes ?? ''),
    c.success_condition_met ? 'PASS' : 'FAIL',
    ...RATING_DIMENSIONS.map((d) => String(c.ratings?.[d] ?? '-')),
  ]);
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(header),
    line(header.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}
