/**
 * Candidate-specific contract tests for FAKE IT TILL YOU CLEAN IT (Task 2).
 *
 * These assert the descriptor's OWN guarantees on top of the shared contract:
 * one set, an inspect objective, a debris collection step, three ordered
 * cleaning passes, a reveal carrying the staged-success clue, an evidence
 * disposition gated behind that reveal, and a next-room hook.
 *
 * They also assert the two deliberate invalid paths produce named blocked
 * requirements rather than a silent soft-lock.
 *
 * Only machine-consumed values are asserted: step ids, kinds, prerequisite
 * edges, transformation keys, and blockedSteps() output. Prose (labels,
 * descriptions, consequence text) is deliberately NOT pinned.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDescriptor, blockedSteps, STEP_KINDS } from '../../core/candidate.js';
import { checkCandidateIsolation } from '../../core/build-identity.js';
import descriptor from '../../candidates/fake_it_till_you_clean_it/scenario.js';

const CONCEPT = 'fake_it_till_you_clean_it';
const stepById = (id) => descriptor.steps.find((s) => s.id === id);
const kinds = () => descriptor.steps.map((s) => s.kind);

// ------------------------------------------------------- shared contract

test('the descriptor satisfies the shared foundation contract', () => {
  const r = validateDescriptor(descriptor, CONCEPT);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test('the descriptor binds itself to its own concept and directory', () => {
  assert.equal(descriptor.concept_id, CONCEPT);
});

test('the candidate imports no other candidate (isolation)', () => {
  const r = checkCandidateIsolation();
  assert.equal(r.ok, true, r.violations.join('; '));
});

// -------------------------------------------------------- scenario shape

test('the scenario declares exactly one gold pool/courtyard set', () => {
  assert.equal(typeof descriptor.set, 'object');
  assert.equal(descriptor.set.id, 'gold_pool_courtyard');
  assert.notEqual(descriptor.set.initial_state, descriptor.set.final_state);
});

test('an inspect objective opens the scenario', () => {
  assert.equal(descriptor.steps[0].kind, 'inspect');
  assert.equal(descriptor.steps[0].id, 'inspect_objective');
  assert.deepEqual(descriptor.steps[0].requires ?? [], []);
});

test('debris collection is a core action gated on the objective', () => {
  const debris = stepById('collect_debris');
  assert.equal(debris.kind, 'core_action');
  assert.equal(debris.debris_cleared, true);
  assert.deepEqual(debris.requires, ['inspect_objective']);
});

test('three ordered cleaning/restoration passes follow debris collection', () => {
  const passes = descriptor.steps
    .filter((s) => Number.isInteger(s.cleaning_pass))
    .sort((a, b) => a.cleaning_pass - b.cleaning_pass);

  assert.equal(passes.length, 3, 'exactly three cleaning passes are required');
  assert.deepEqual(passes.map((s) => s.cleaning_pass), [1, 2, 3]);
  for (const p of passes) assert.equal(p.kind, 'core_action');

  // Each pass depends on the previous one: the order is enforced, not implied.
  assert.deepEqual(passes[0].requires, ['collect_debris']);
  assert.deepEqual(passes[1].requires, [passes[0].id]);
  assert.deepEqual(passes[2].requires, [passes[1].id]);
});

test('every step carries a label and a visible before/after transformation', () => {
  for (const step of descriptor.steps) {
    assert.equal(typeof step.label, 'string', `${step.id} needs a label`);
    assert.notEqual(step.label.trim(), '', `${step.id} label must not be empty`);
    assert.ok(step.transformation, `${step.id} needs a transformation`);
    assert.equal(typeof step.transformation.before, 'string');
    assert.equal(typeof step.transformation.after, 'string');
    assert.notEqual(
      step.transformation.before,
      step.transformation.after,
      `${step.id} transformation must be visible (before !== after)`,
    );
  }
});

test('the physical set state chains unbroken from staged gold to decay', () => {
  // The opening inspect changes what the CONTRACTOR knows, not what the set
  // looks like, so it is not part of the physical chain. Every step that does
  // alter the set must start from the state the previous one left behind.
  const setSteps = descriptor.replay
    .map((id) => stepById(id))
    .filter((s) => s.kind !== 'inspect');

  assert.equal(
    setSteps[0].transformation.before,
    descriptor.set.initial_state,
    'the first set-altering step must start from the set initial_state',
  );
  for (let i = 1; i < setSteps.length; i += 1) {
    assert.equal(
      setSteps[i].transformation.before,
      setSteps[i - 1].transformation.after,
      `set state chain breaks entering ${setSteps[i].id}`,
    );
  }
  assert.equal(
    setSteps[setSteps.length - 1].transformation.after,
    descriptor.set.final_state,
    'the last step must leave the set in its declared final_state',
  );
});

// ------------------------------------------------------- reveal + choice

test('the reveal exposes the decayed surface and a staged-success clue', () => {
  const reveal = stepById('reveal_decayed_surface');
  assert.equal(reveal.kind, 'reveal');
  assert.equal(kinds().filter((k) => k === 'reveal').length, 1);
  assert.equal(reveal.transformation.after, descriptor.visible_proof.after);
  assert.ok(reveal.staged_success_clue, 'the reveal must carry the staged-success clue');
  assert.equal(typeof reveal.staged_success_clue.id, 'string');
  assert.equal(typeof reveal.staged_success_clue.proves, 'string');
  // The reveal may only fire after the last cleaning pass.
  assert.deepEqual(reveal.requires, ['strip_deck']);
});

test('the evidence choice offers exactly preserve, discard, and archive', () => {
  const choice = stepById('disposition');
  assert.equal(choice.kind, 'choice');
  assert.equal(kinds().filter((k) => k === 'choice').length, 1);
  assert.deepEqual(choice.options.map((o) => o.id).sort(), ['archive', 'discard', 'preserve']);
  for (const o of choice.options) {
    assert.equal(typeof o.consequence, 'string');
    assert.notEqual(o.consequence.trim(), '');
  }
  assert.ok(choice.options.some((o) => o.id === choice.default_option));
  // The choice acts on the object the reveal uncovered.
  assert.equal(choice.evidence_object, stepById('reveal_decayed_surface').staged_success_clue.id);
});

test('the visible proof contrasts the staged gold set with the decayed surface', () => {
  assert.equal(descriptor.visible_proof.before, descriptor.set.initial_state);
  assert.notEqual(descriptor.visible_proof.before, descriptor.visible_proof.after);
});

test('a next-room hook is declared without building a second room', () => {
  assert.equal(typeof descriptor.next_hook.label, 'string');
  // The hook is data only: no extra room appears as a playable step.
  const roomSteps = descriptor.steps.filter((s) => /guest_wing|second_room/.test(s.id));
  assert.equal(roomSteps.length, 0, 'the hook must not add a second playable room');
});

// ------------------------------------------------------- invalid paths

test('replay completes every declared step and leaves nothing blocked', () => {
  assert.deepEqual(
    [...descriptor.replay].sort(),
    descriptor.steps.map((s) => s.id).sort(),
    'replay must cover every step exactly once',
  );
  assert.equal(new Set(descriptor.replay).size, descriptor.replay.length);
  assert.equal(blockedSteps(descriptor, descriptor.replay).length, 0);
});

test('replay order never runs a step before its prerequisites', () => {
  const done = [];
  for (const id of descriptor.replay) {
    const blocked = blockedSteps(descriptor, done).find((b) => b.id === id);
    assert.equal(blocked, undefined, `replay runs ${id} while blocked on ${blocked?.missing}`);
    done.push(id);
  }
});

test('evidence disposition before the reveal is blocked by name', () => {
  const path = descriptor.invalid_paths.find((p) => p.id === 'disposition_before_reveal');
  const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
  assert.ok(blocked, 'dispositioning evidence before the reveal must be blocked');
  assert.deepEqual(blocked.missing, path.expect_missing);
  assert.equal(typeof path.requirement, 'string');
  assert.notEqual(path.requirement.trim(), '');
});

test('exiting with debris remaining is blocked by name', () => {
  const path = descriptor.invalid_paths.find((p) => p.id === 'exit_with_debris_remaining');
  const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
  assert.ok(blocked, 'the reveal must be blocked while cleaning passes remain');
  assert.deepEqual(blocked.missing, path.expect_missing);

  // ...and the scenario cannot be completed in that state: steps remain.
  const remaining = descriptor.steps.filter((s) => !path.completed.includes(s.id));
  assert.ok(remaining.length > 0, 'incomplete cleaning must leave steps outstanding');
});

test('every declared invalid path really is blocked (no decorative claims)', () => {
  assert.ok(descriptor.invalid_paths.length >= 2);
  for (const path of descriptor.invalid_paths) {
    const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
    assert.ok(blocked, `${path.id}: declared invalid path is not actually blocked`);
    assert.deepEqual(blocked.missing, path.expect_missing, `${path.id}: wrong missing prerequisites`);
  }
});

// --------------------------------------------------- event-kind coverage

test('the step kinds cover every required shared event', () => {
  const events = new Set(descriptor.steps.map((s) => STEP_KINDS[s.kind]));
  for (const required of ['inspect_performed', 'core_action_completed', 'signature_reveal_seen', 'choice_committed']) {
    assert.ok(events.has(required), `no step produces ${required}`);
  }
  assert.ok(
    kinds().filter((k) => k === 'core_action').length >= 4,
    'debris collection plus three cleaning passes means at least four core actions',
  );
});
