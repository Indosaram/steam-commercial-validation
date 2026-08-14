/**
 * Owner-direct-play selection gate.
 *
 * This module deliberately keeps owner judgment separate from automated
 * smoke output. A scorecard is eligible only when it is explicitly marked as
 * owner input and is tied to the exact packaged build and telemetry trace.
 */

import { CONCEPT_IDS, isConceptId } from './concepts.js';
import { RATING_DIMENSIONS, validateScorecard } from './scorecard.js';

export const OWNER_SELECTION_VERSION = 1;

const MIN_FINALISTS = 1;
const MAX_FINALISTS = 2;
const MIN_REPEAT_SATISFACTION = 4;
const MIN_NEXT_SCENARIO_DESIRE = 4;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushMissing(errors, value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`);
  }
}

function verifiedBuildFor(verifiedBuilds, conceptId) {
  if (verifiedBuilds instanceof Map) return verifiedBuilds.get(conceptId);
  return verifiedBuilds?.[conceptId];
}

function validateVerifiedBuilds(verifiedBuilds, errors) {
  if (!isRecord(verifiedBuilds) && !(verifiedBuilds instanceof Map)) {
    errors.push('verifiedBuilds must be a concept-to-build record');
    return;
  }
  for (const conceptId of CONCEPT_IDS) {
    const build = verifiedBuildFor(verifiedBuilds, conceptId);
    if (!isRecord(build)) {
      errors.push(`missing verified build for ${conceptId}`);
      continue;
    }
    pushMissing(errors, build.build_id, `verified build_id for ${conceptId}`);
    pushMissing(errors, build.build_hash, `verified build_hash for ${conceptId}`);
  }
}

function validateScorecardEntry(card, index, verifiedBuilds, errors) {
  const prefix = `scorecards[${index}]`;
  const result = validateScorecard(card);
  for (const error of result.errors) errors.push(`${prefix}: ${error}`);

  if (!isRecord(card)) return;
  if (card.owner_input !== true) {
    errors.push(`${prefix}: owner_input must be true; automated placeholders are not owner input`);
  }
  if (card.success_condition_met !== true) {
    errors.push(`${prefix}: success_condition_met must be true`);
  }
  if (!Number.isInteger(card.forced_rank) || card.forced_rank < 1 || card.forced_rank > CONCEPT_IDS.length) {
    errors.push(`${prefix}: forced_rank must be an integer from 1 to ${CONCEPT_IDS.length}`);
  }
  pushMissing(errors, card.telemetry_trace, `${prefix}.telemetry_trace`);
  pushMissing(errors, card.stop_or_continue, `${prefix}.stop_or_continue`);

  if (!isConceptId(card.concept_id)) return;
  const verified = verifiedBuildFor(verifiedBuilds, card.concept_id);
  if (!verified) return;
  if (card.build_id !== verified.build_id) {
    errors.push(`${prefix}: build_id does not match verified package for ${card.concept_id}`);
  }
  if (card.build_hash !== verified.build_hash) {
    errors.push(`${prefix}: unverified build hash for ${card.concept_id}`);
  }
}

function validateScorecardSet(scorecards, verifiedBuilds, errors) {
  if (!Array.isArray(scorecards)) {
    errors.push('scorecards must be an array');
    return;
  }
  if (scorecards.length !== CONCEPT_IDS.length) {
    errors.push(`scorecards must contain all ${CONCEPT_IDS.length} candidates exactly once`);
  }

  const concepts = new Set();
  const ranks = new Set();
  for (const [index, card] of scorecards.entries()) {
    validateScorecardEntry(card, index, verifiedBuilds, errors);
    if (!isRecord(card)) continue;
    if (isConceptId(card.concept_id)) {
      if (concepts.has(card.concept_id)) errors.push(`duplicate candidate scorecard: ${card.concept_id}`);
      concepts.add(card.concept_id);
    }
    if (Number.isInteger(card.forced_rank)) {
      if (ranks.has(card.forced_rank)) errors.push('forced ranks must be unique');
      ranks.add(card.forced_rank);
    }
  }

  for (const conceptId of CONCEPT_IDS) {
    if (!concepts.has(conceptId)) errors.push(`missing candidate scorecard: ${conceptId}`);
  }
  for (let rank = 1; rank <= CONCEPT_IDS.length; rank += 1) {
    if (!ranks.has(rank)) errors.push(`forced ranking is missing rank ${rank}`);
  }
}

function finalistFor(finalists, conceptId) {
  return finalists.find((finalist) => finalist?.concept_id === conceptId);
}

function validateFinalists(input, errors) {
  const finalists = input.finalists;
  if (!Array.isArray(finalists)) {
    errors.push('finalists must be an array');
    return;
  }
  if (finalists.length < MIN_FINALISTS || finalists.length > MAX_FINALISTS) {
    errors.push(`finalists must contain ${MIN_FINALISTS}-${MAX_FINALISTS} candidates`);
  }

  const ids = new Set();
  for (const [index, finalist] of finalists.entries()) {
    const prefix = `finalists[${index}]`;
    if (!isRecord(finalist) || !isConceptId(finalist.concept_id)) {
      errors.push(`${prefix}: concept_id must identify one candidate`);
      continue;
    }
    if (ids.has(finalist.concept_id)) errors.push(`duplicate finalist: ${finalist.concept_id}`);
    ids.add(finalist.concept_id);
    pushMissing(errors, finalist.rationale, `${prefix}.rationale`);
    pushMissing(errors, finalist.repeat_variation_path, `${prefix}.repeat_variation_path`);
  }
}

function validatePromotionThresholds(scorecards, finalists, errors) {
  if (!Array.isArray(scorecards) || !Array.isArray(finalists)) return;
  for (const finalist of finalists) {
    const card = scorecards.find((candidate) => candidate?.concept_id === finalist?.concept_id);
    if (!card) continue;
    if (card.ratings?.repeated_action_satisfaction < MIN_REPEAT_SATISFACTION) {
      errors.push(`${finalist.concept_id}: repeated_action_satisfaction must be at least ${MIN_REPEAT_SATISFACTION}`);
    }
    if (card.ratings?.next_scenario_desire < MIN_NEXT_SCENARIO_DESIRE) {
      errors.push(`${finalist.concept_id}: next_scenario_desire must be at least ${MIN_NEXT_SCENARIO_DESIRE}`);
    }
  }
}

function validateNonPromotedReasons(input, errors) {
  const reasons = input.non_promoted_reasons;
  if (!isRecord(reasons)) {
    errors.push('non_promoted_reasons must be an object');
    return;
  }
  const finalistIds = new Set((input.finalists ?? []).map((finalist) => finalist?.concept_id));
  for (const conceptId of CONCEPT_IDS) {
    if (finalistIds.has(conceptId)) continue;
    pushMissing(errors, reasons[conceptId], `non_promoted_reasons.${conceptId}`);
  }
  for (const key of Object.keys(reasons)) {
    if (!isConceptId(key)) errors.push(`non_promoted_reasons contains unknown candidate: ${key}`);
  }
}

/**
 * Validate the complete owner-selection import.
 * @param {unknown} input
 * @param {{verifiedBuilds: Record<string, {build_id: string, build_hash: string}>|Map}} options
 */
export function validateOwnerSelectionInput(input, { verifiedBuilds } = {}) {
  const errors = [];
  if (!isRecord(input)) return { ok: false, errors: ['owner selection input must be a JSON object'] };
  if (input.owner_selection_version !== OWNER_SELECTION_VERSION) {
    errors.push(`owner_selection_version must be ${OWNER_SELECTION_VERSION}`);
  }
  pushMissing(errors, input.owner_id, 'owner_id');
  validateVerifiedBuilds(verifiedBuilds, errors);
  validateScorecardSet(input.scorecards, verifiedBuilds, errors);
  validateFinalists(input, errors);
  validatePromotionThresholds(input.scorecards, input.finalists, errors);
  validateNonPromotedReasons(input, errors);

  if (Array.isArray(input.scorecards)) {
    for (const dimension of RATING_DIMENSIONS) {
      const missing = input.scorecards.some((card) => !card?.ratings || !(dimension in card.ratings));
      if (missing) errors.push(`all scorecards must include rating dimension: ${dimension}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Create the traceable owner decision artifact after validation succeeds.
 * @param {object} input
 * @param {{verifiedBuilds: Record<string, {build_id: string, build_hash: string}>|Map}} options
 */
export function buildOwnerSelectionDecision(input, { verifiedBuilds } = {}) {
  const validation = validateOwnerSelectionInput(input, { verifiedBuilds });
  if (!validation.ok) throw new Error(`owner selection input is invalid: ${validation.errors.join('; ')}`);

  const ranking = [...input.scorecards]
    .sort((a, b) => a.forced_rank - b.forced_rank)
    .map((card) => ({
      concept_id: card.concept_id,
      forced_rank: card.forced_rank,
      build_id: card.build_id,
      build_hash: card.build_hash,
      telemetry_trace: card.telemetry_trace,
      ratings: { ...card.ratings },
      active_minutes: card.active_minutes,
      stop_or_continue: card.stop_or_continue,
    }));

  const finalistIds = new Set(input.finalists.map((finalist) => finalist.concept_id));
  return {
    owner_selection_version: OWNER_SELECTION_VERSION,
    owner_id: input.owner_id,
    generated_at: input.generated_at ?? null,
    ranking,
    finalists: input.finalists.map((finalist) => ({
      concept_id: finalist.concept_id,
      forced_rank: ranking.find((row) => row.concept_id === finalist.concept_id).forced_rank,
      build_id: ranking.find((row) => row.concept_id === finalist.concept_id).build_id,
      build_hash: ranking.find((row) => row.concept_id === finalist.concept_id).build_hash,
      telemetry_trace: ranking.find((row) => row.concept_id === finalist.concept_id).telemetry_trace,
      rationale: finalist.rationale,
      repeat_variation_path: finalist.repeat_variation_path,
    })),
    non_promoted: CONCEPT_IDS
      .filter((conceptId) => !finalistIds.has(conceptId))
      .map((conceptId) => ({
        concept_id: conceptId,
        forced_rank: ranking.find((row) => row.concept_id === conceptId).forced_rank,
        reason: input.non_promoted_reasons[conceptId],
      })),
    evidence: ranking.map((row) => ({
      concept_id: row.concept_id,
      build_id: row.build_id,
      build_hash: row.build_hash,
      telemetry_trace: row.telemetry_trace,
    })),
  };
}

