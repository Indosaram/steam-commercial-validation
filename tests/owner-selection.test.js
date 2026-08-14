import test from 'node:test';
import assert from 'node:assert/strict';

import { CONCEPT_IDS } from '../core/concepts.js';
import { runScenario } from '../core/shell-core.js';
import { buildScorecard } from '../core/scorecard.js';
import {
  buildOwnerSelectionDecision,
  validateOwnerSelectionInput,
} from '../core/owner-selection.js';

const RATINGS = {
  role_clarity: 4,
  first_payoff_timing: 4,
  repeated_action_satisfaction: 5,
  signature_reveal_memorability: 4,
  meaningful_choice: 4,
  next_scenario_desire: 5,
  five_to_ten_hour_potential: 4,
};

function verifiedBuilds() {
  return Object.fromEntries(
    CONCEPT_IDS.map((conceptId) => [
      conceptId,
      {
        build_id: `build-${conceptId}`,
        build_hash: `hash-${conceptId}`,
      },
    ]),
  );
}

function ownerCard(conceptId, rank, overrides = {}) {
  const session = runScenario({ conceptId, seed: 7 });
  const card = buildScorecard({ session, ratings: RATINGS, notes: 'owner note' });
  return {
    ...card,
    build_id: `build-${conceptId}`,
    build_hash: `hash-${conceptId}`,
    owner_input: true,
    forced_rank: rank,
    telemetry_trace: `traces/${conceptId}.session.json`,
    stop_or_continue: 'Continue: the next scenario has a credible variation path.',
    ...overrides,
  };
}

function validInput() {
  return {
    owner_selection_version: 1,
    owner_id: 'owner-1',
    scorecards: CONCEPT_IDS.map((conceptId, index) => ownerCard(conceptId, index + 1)),
    finalists: [
      {
        concept_id: CONCEPT_IDS[0],
        rationale: 'The repeated action stayed satisfying and the reveal created a clear continuation.',
        repeat_variation_path: 'Vary surface materials and evidence choices across future rooms.',
      },
      {
        concept_id: CONCEPT_IDS[1],
        rationale: 'The sorting decisions remained legible and invite escalating route variations.',
        repeat_variation_path: 'Vary parcel constraints, route priorities, and recurring recipient patterns.',
      },
    ],
    non_promoted_reasons: {
      [CONCEPT_IDS[2]]: 'The show payoff landed, but the repeated triage became less satisfying.',
      [CONCEPT_IDS[3]]: 'The reveal was memorable, but the next-scenario desire was not strong enough.',
      [CONCEPT_IDS[4]]: 'The evidence loop was clear, but the owner did not identify enough repeat variation.',
    },
  };
}

test('a complete owner input produces a ranked finalist decision', () => {
  const input = validInput();
  const validation = validateOwnerSelectionInput(input, { verifiedBuilds: verifiedBuilds() });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));

  const decision = buildOwnerSelectionDecision(input, { verifiedBuilds: verifiedBuilds() });
  assert.deepEqual(
    decision.ranking.map((row) => row.concept_id),
    CONCEPT_IDS,
  );
  assert.deepEqual(
    decision.finalists.map((row) => row.concept_id),
    [CONCEPT_IDS[0], CONCEPT_IDS[1]],
  );
  assert.equal(decision.non_promoted.length, 3);
  assert.equal(decision.evidence[0].build_hash, `hash-${CONCEPT_IDS[0]}`);
});

test('placeholder smoke scorecards are rejected as non-owner input', () => {
  const input = validInput();
  input.scorecards[0].owner_input = false;
  const result = validateOwnerSelectionInput(input, { verifiedBuilds: verifiedBuilds() });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /owner_input/i.test(error)));
});

test('duplicate forced ranks are rejected', () => {
  const input = validInput();
  input.scorecards[1].forced_rank = input.scorecards[0].forced_rank;
  const result = validateOwnerSelectionInput(input, { verifiedBuilds: verifiedBuilds() });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /forced ranks must be unique/i.test(error)));
});

test('an unverified build hash is rejected', () => {
  const input = validInput();
  input.scorecards[0].build_hash = 'hash-not-in-package';
  const result = validateOwnerSelectionInput(input, { verifiedBuilds: verifiedBuilds() });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /unverified build hash/i.test(error)));
});

test('a finalist needs high satisfaction, next-scenario desire, and a variation path', () => {
  const input = validInput();
  input.scorecards[0].ratings.repeated_action_satisfaction = 3;
  const result = validateOwnerSelectionInput(input, { verifiedBuilds: verifiedBuilds() });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /repeated_action_satisfaction/i.test(error)));

  const nextInput = validInput();
  delete nextInput.finalists[0].repeat_variation_path;
  const nextResult = validateOwnerSelectionInput(nextInput, { verifiedBuilds: verifiedBuilds() });
  assert.equal(nextResult.ok, false);
  assert.ok(nextResult.errors.some((error) => /repeat_variation_path/i.test(error)));
});

