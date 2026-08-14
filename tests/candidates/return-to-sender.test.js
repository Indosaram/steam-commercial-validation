/**
 * Task 3 - RETURN TO SENDER candidate tests.
 *
 * Owned by the parcel-overflow candidate. Every assertion runs against the REAL
 * descriptor on disk (candidates/return_to_sender/scenario.js) through the
 * SHARED contract (core/candidate.js, core/telemetry.js), so this suite fails
 * if either the candidate content or its integration with the foundation
 * regresses. It re-implements no validation of its own.
 *
 * Run:
 *   node --test tests/candidates/return-to-sender.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getConcept } from '../../core/concepts.js';
import {
  loadCandidateScenario,
  hasCandidateScenario,
  validateDescriptor,
  blockedSteps,
  STEP_KINDS,
} from '../../core/candidate.js';
import { validateSession, REQUIRED_EVENTS } from '../../core/telemetry.js';
import { checkCandidateIsolation } from '../../core/build-identity.js';
import { runReplay, validScript, PARCEL_CATEGORIES, CONCEPT_ID } from '../../candidates/return_to_sender/replay.js';

const descriptor = await loadCandidateScenario(CONCEPT_ID);

/** Press the verb that reaches a given step kind in the shared shell. */
const VERB_FOR = { inspect: 'interact', core_action: 'core_action', reveal: 'inspect', choice: 'commit_choice' };

// -------------------------------------------------------- shared contract

test('the parcel-overflow candidate ships an on-disk descriptor', () => {
  assert.equal(hasCandidateScenario(CONCEPT_ID), true);
  assert.ok(descriptor, 'loadCandidateScenario must return the descriptor');
  assert.equal(descriptor.concept_id, CONCEPT_ID);
});

test('the descriptor satisfies the shared foundation contract', () => {
  const r = validateDescriptor(descriptor, CONCEPT_ID);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test('the descriptor declares the shared required beats', () => {
  const kinds = descriptor.steps.map((s) => s.kind);
  assert.ok(kinds.filter((k) => k === 'core_action').length >= 3, 'at least three core actions');
  assert.equal(kinds.includes('reveal'), true, 'signature reveal present');
  assert.equal(kinds.includes('choice'), true, 'meaningful choice present');
  assert.equal(kinds.includes('inspect'), true, 'scan/inspect present');
  for (const kind of new Set(kinds)) {
    assert.ok(STEP_KINDS[kind], `kind ${kind} maps to a shared event`);
  }
});

test('the replay ordering covers every declared step exactly once', () => {
  assert.deepEqual(
    [...descriptor.replay].sort(),
    descriptor.steps.map((s) => s.id).sort(),
    'replay must drive every step',
  );
  assert.equal(new Set(descriptor.replay).size, descriptor.replay.length, 'no repeats');
});

test('every step declares ordered prerequisites and no step is reachable out of order', () => {
  const order = descriptor.steps.map((s) => s.id);
  descriptor.steps.forEach((step, i) => {
    if (i === 0) return;
    assert.ok(
      Array.isArray(step.requires) && step.requires.length > 0,
      `${step.id} must declare prerequisites`,
    );
    for (const req of step.requires) {
      assert.ok(order.indexOf(req) < i, `${step.id} requires ${req}, which must be an earlier step`);
    }
  });
});

test('the candidate imports no other candidate', () => {
  const r = checkCandidateIsolation();
  assert.equal(r.ok, true, r.violations.join('; '));
});

// ------------------------------------------------------- scenario content

test('the scenario scans the obstruction before anything can be moved', () => {
  const first = descriptor.steps[0];
  assert.equal(first.kind, 'inspect');
  assert.equal(first.id, 'scan_obstruction');
  // Every other step transitively depends on the scan.
  const afterScanOnly = blockedSteps(descriptor, []);
  assert.equal(
    afterScanOnly.length,
    descriptor.steps.length - 1,
    'every step but the scan is blocked before the scan',
  );
});

test('at least the normal, fragile and return parcel categories are resolved', () => {
  const categories = descriptor.steps
    .filter((s) => s.kind === 'core_action' && s.parcel_category)
    .map((s) => s.parcel_category);
  for (const required of PARCEL_CATEGORIES) {
    assert.ok(categories.includes(required), `missing parcel category: ${required}`);
  }
});

test('exactly one priority decision is committed and it gates the compactor and the exit', () => {
  const priority = descriptor.steps.find((s) => s.id === 'priority_order_committed');
  assert.ok(priority, 'a priority-order step must exist');
  assert.ok(priority.decision?.committed, 'the priority order must record what was committed');
  assert.ok(
    priority.decision.options.length >= 2,
    'a decision needs alternatives, otherwise it is not a decision',
  );

  const compactor = descriptor.steps.find((s) => s.id === 'route_compactor');
  assert.ok(
    compactor.requires.includes('priority_order_committed'),
    'the compactor must be interlocked behind the priority order',
  );
  // The exit is gated because the shared shell refuses completion while any
  // step is incomplete, and the priority step precedes the remaining steps.
  const stillBlocked = blockedSteps(descriptor, ['scan_obstruction', 'sort_normal_bulk', 'sort_fragile_divert', 'sort_return_stack']);
  assert.ok(stillBlocked.some((b) => b.id === 'route_compactor'));
});

test('a compactor or routing action is used and it restores lane access', () => {
  const compactor = descriptor.steps.find((s) => s.id === 'route_compactor');
  assert.equal(compactor.kind, 'core_action');
  const restore = descriptor.steps.find((s) => s.id === 'restore_lane_access');
  assert.ok(restore.requires.includes('route_compactor'));
  assert.equal(restore.transformation.after, 'lane_access_restored');
});

test('the reveal is a recurring recipient with a failed subscription', () => {
  const reveal = descriptor.steps.find((s) => s.kind === 'reveal');
  assert.ok(reveal.clue, 'the reveal must carry a machine-readable clue');
  assert.ok(reveal.clue.recipient_code, 'a recurring recipient code');
  assert.ok(reveal.clue.failed_subscription, 'a failed subscription');
  assert.ok(reveal.requires.includes('restore_lane_access'), 'the reveal follows the restored lane');
});

test('a next blocked-lane hook is provided and reuses the recurring recipient code', () => {
  const reveal = descriptor.steps.find((s) => s.kind === 'reveal');
  assert.ok(descriptor.next_hook?.text, 'a next-scenario hook must exist');
  assert.match(descriptor.next_hook.text, /blocked/i, 'the hook must point at another blocked lane');
  assert.ok(
    descriptor.next_hook.text.includes(reveal.clue.recipient_code),
    'the hook must carry the same recurring recipient code',
  );
});

test('every step declares a visible before/after transformation or is the scan', () => {
  for (const step of descriptor.steps) {
    assert.ok(step.transformation, `${step.id} must declare a visible transformation`);
    assert.ok(step.transformation.before, `${step.id} needs a before state`);
    assert.ok(step.transformation.after, `${step.id} needs an after state`);
    assert.notEqual(
      step.transformation.before,
      step.transformation.after,
      `${step.id} must actually change the visible state`,
    );
  }
});

test('the transformation chain is continuous from blocked lane to cleared lane', () => {
  const ordered = descriptor.replay.map((id) => descriptor.steps.find((s) => s.id === id));
  assert.equal(ordered[0].transformation.before, 'lane_blocked_full');
  for (let i = 1; i < ordered.length; i += 1) {
    assert.equal(
      ordered[i].transformation.before,
      ordered[i - 1].transformation.after,
      `transformation chain breaks at ${ordered[i].id}`,
    );
  }
  assert.equal(ordered.at(-1).transformation.after, 'lane_clear_loop_flagged');
});

// ------------------------------------------------------------ happy replay

test('the valid replay emits every required shared event in causal order', () => {
  const run = runReplay(descriptor, { label: 'test-valid', script: validScript(descriptor) });
  const r = validateSession(run.events);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  for (const required of REQUIRED_EVENTS) {
    assert.ok(run.events.some((e) => e.event === required), `missing ${required}`);
  }
  assert.ok(run.events.some((e) => e.event === 'next_hook_shown'), 'missing next_hook_shown');
  assert.equal(run.completed_scenario, true);
});

test('the valid replay resolves three parcel categories and uses the compactor', () => {
  const run = runReplay(descriptor, { label: 'test-valid', script: validScript(descriptor) });
  const resolved = run.events
    .filter((e) => e.event === 'core_action_completed' && e.payload.parcel_category)
    .map((e) => e.payload.parcel_category);
  for (const required of PARCEL_CATEGORIES) {
    assert.ok(resolved.includes(required), `replay never resolved a ${required} parcel`);
  }
  assert.ok(run.completed.includes('route_compactor'), 'compactor/routing action unused');
  assert.ok(run.completed.includes('restore_lane_access'), 'lane access never restored');
  assert.equal(run.lane_state, 'lane_clear_loop_flagged');
});

test('the valid replay lands inside the shared 10-15 minute window', () => {
  const run = runReplay(descriptor, { label: 'test-valid', script: validScript(descriptor) });
  const minutes = run.active_ms / 60000;
  assert.ok(minutes >= 10 && minutes <= 15, `active minutes ${minutes.toFixed(2)} outside 10-15`);
});

test('the valid replay is deterministic', () => {
  const a = runReplay(descriptor, { label: 'det', script: validScript(descriptor) });
  const b = runReplay(descriptor, { label: 'det', script: validScript(descriptor) });
  assert.deepEqual(a.events, b.events, 'same label + script must reproduce the same stream');
});

test('the replay carries this candidate concept and one build id', () => {
  const run = runReplay(descriptor, { label: 'test-valid', script: validScript(descriptor) });
  assert.equal(new Set(run.events.map((e) => e.concept_id)).size, 1);
  assert.equal(run.events[0].concept_id, CONCEPT_ID);
  assert.equal(new Set(run.events.map((e) => e.build_id)).size, 1);
  assert.match(run.build_id, new RegExp(`\\+${CONCEPT_ID}\\.`));
});

// ---------------------------------------------------------- invalid paths

test('invalid path: compacting before fragile diversion and priority is blocked by name', () => {
  const compactor = descriptor.steps.find((s) => s.id === 'route_compactor');
  assert.ok(
    compactor.requires.includes('sort_fragile_divert'),
    'the compactor must require the fragile parcel to be out of its path',
  );
  const run = runReplay(descriptor, {
    label: 'test-invalid-fragile-priority',
    script: ['interact', { step_id: 'route_compactor' }],
  });
  const block = run.blocked.find((b) => b.attempted === 'route_compactor');
  assert.deepEqual(block.missing, ['sort_fragile_divert', 'priority_order_committed']);
  assert.equal(block.recoverable, true);
  assert.ok(block.penalty.some((p) => p.includes('compactor_interlock_fragile')));
  assert.ok(block.penalty.some((p) => p.includes('compactor_interlock_no_priority')));
  assert.ok(!run.events.some((e) => e.event === 'scenario_completed'));
});

test('invalid path: compacting before the priority queue is a named recoverable penalty', () => {
  const script = ['interact', 'core_action', 'core_action', 'core_action', 'core_action'];
  const run = runReplay(descriptor, { label: 'test-invalid-compact', script });

  const block = run.blocked.find((b) => b.attempted === 'route_compactor');
  assert.ok(block, 'the compactor attempt must be blocked');
  assert.deepEqual(block.missing, ['priority_order_committed']);
  assert.equal(block.recoverable, true);
  assert.ok(
    block.penalty.some((p) => p.includes('compactor_interlock_no_priority')),
    'the penalty must be named, not generic',
  );
  assert.equal(run.completed_scenario, false, 'a blocked compaction must not complete the scenario');
  assert.ok(
    run.events.some((e) => e.event === 'invalid_action_blocked'),
    'the block must be visible in telemetry',
  );
  assert.ok(
    !run.events.some((e) => e.event === 'scenario_completed'),
    'no scenario_completed may be emitted on a blocked path',
  );
});

test('invalid path: exiting before the priority queue is resolved is blocked with no completion', () => {
  const script = ['interact', 'core_action', 'core_action', 'core_action', 'advance'];
  const run = runReplay(descriptor, { label: 'test-invalid-exit', script });

  const block = run.blocked.find((b) => b.attempted === 'scenario_completed');
  assert.ok(block, 'the exit attempt must be blocked');
  assert.equal(block.reason, 'beats_incomplete');
  assert.ok(
    block.missing.includes('priority_order_committed'),
    'the block must name the unresolved priority queue',
  );
  assert.equal(run.completed_scenario, false);
  assert.ok(!run.events.some((e) => e.event === 'scenario_completed'));
});

test('a blocked attempt is recoverable: the same session still completes validly', () => {
  const script = ['core_action', 'commit_choice', 'inspect', 'advance', ...validScript(descriptor)];
  const run = runReplay(descriptor, { label: 'test-recovery', script });

  assert.ok(run.blocked.length >= 3, 'the invalid attempts must all be blocked');
  assert.equal(run.completed_scenario, true, 'the scenario must still be completable after blocks');
  const r = validateSession(run.events);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  assert.equal(run.lane_state, 'lane_clear_loop_flagged');
});

test('no progress is destroyed by a blocked attempt', () => {
  const before = runReplay(descriptor, { label: 'p', script: ['interact', 'core_action', 'core_action', 'core_action'] });
  const after = runReplay(descriptor, {
    label: 'p',
    script: ['interact', 'core_action', 'core_action', 'core_action', 'core_action'],
  });
  assert.deepEqual(after.completed, before.completed, 'a blocked step must not roll back completed steps');
});

// -------------------------------------------------------------- guardrails

test('the candidate declares and honours the marketplace guardrails', () => {
  assert.ok(descriptor.guardrails, 'guardrails must be declared for the scope audit');
  const src = JSON.stringify(descriptor);
  for (const banned of ['Math.random', 'wishlist', 'gacha', 'loot box', 'lootbox', 'wager']) {
    assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), `descriptor must not contain ${banned}`);
  }
});

test('parcel resolution has no value, price or reward payload', () => {
  const run = runReplay(descriptor, { label: 'guard', script: validScript(descriptor) });
  for (const e of run.events) {
    const keys = Object.keys(e.payload ?? {});
    for (const banned of ['value', 'price', 'reward', 'currency', 'rarity', 'roll']) {
      assert.ok(!keys.includes(banned), `event ${e.event} exposes a ${banned} payload`);
    }
  }
});

test('the scenario stays scoped to one container and one alley', () => {
  const concept = getConcept(CONCEPT_ID);
  assert.equal(concept.concept_id, CONCEPT_ID);
  assert.ok(descriptor.setting.includes('alley 7'), 'the setting names the single alley');
  assert.ok(descriptor.steps.length <= 12, 'a 10-15 minute scenario must not sprawl into a city map');
});
