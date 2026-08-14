/**
 * Candidate-specific contract tests for FAKE IT TILL YOU CLEAN IT.
 *
 * These assert the descriptor's own guarantees on top of the shared contract:
 * one composite estate set, an inspect objective, debris collection, the three
 * original ordered courtyard cleaning passes, the pool reveal, a second-area
 * glamour vanity restoration, a hidden-safe receipt clue, evidence disposition,
 * and a next-zone hook.
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

test('the scenario declares the gold pool/courtyard set with a glamour vanity second area', () => {
  assert.equal(typeof descriptor.set, 'object');
  assert.equal(descriptor.set.id, 'gold_pool_courtyard');
  assert.notEqual(descriptor.set.initial_state, descriptor.set.final_state);
  assert.deepEqual(descriptor.set.areas.map((area) => area.id), [
    'gold_pool_courtyard',
    'glamour_vanity',
  ]);
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

  assert.equal(passes.length, 3, 'the original courtyard contract keeps exactly three cleaning passes');
  assert.deepEqual(passes.map((s) => s.cleaning_pass), [1, 2, 3]);
  assert.deepEqual(passes.map((s) => s.id), ['drain_pool', 'strip_basin', 'strip_deck']);
  for (const p of passes) assert.equal(p.kind, 'core_action');

  assert.deepEqual(passes[0].requires, ['collect_debris']);
  assert.deepEqual(passes[1].requires, [passes[0].id]);
  assert.deepEqual(passes[2].requires, [passes[1].id]);

  const vanity = stepById('restore_glamour_vanity');
  assert.equal(vanity.cleaning_pass, undefined, 'the second-area restoration must not renumber the three courtyard passes');
  assert.equal(vanity.restoration_extension, 1);
});

test('the glamour vanity restoration and safe receipt clue are ordered and transformed', () => {
  const vanity = stepById('restore_glamour_vanity');
  const receipt = stepById('safe_receipt_clue');

  assert.equal(vanity.kind, 'core_action');
  assert.equal(vanity.area_id, 'glamour_vanity');
  assert.deepEqual(vanity.requires, ['reveal_decayed_surface']);
  assert.notEqual(vanity.transformation.before, vanity.transformation.after);

  assert.equal(receipt.kind, 'inspect');
  assert.equal(receipt.area_id, 'glamour_vanity');
  assert.deepEqual(receipt.requires, ['restore_glamour_vanity']);
  assert.equal(receipt.transformation.before, vanity.transformation.after);
  assert.notEqual(receipt.transformation.before, receipt.transformation.after);
  assert.equal(receipt.evidence_clue.id, 'safe_receipt_clue');
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

test('the physical set state chains unbroken from staged gold through the safe receipt to archive', () => {
  // inspect_objective changes contractor knowledge rather than the physical set.
  // safe_receipt_clue, however, opens the safe and therefore participates in
  // the authored physical transformation chain despite being an inspect step.
  const setSteps = descriptor.replay
    .map((id) => stepById(id))
    .filter((s) => s.id !== 'inspect_objective');

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
  const vanity = stepById('restore_glamour_vanity');
  assert.equal(reveal.kind, 'reveal');
  assert.equal(kinds().filter((k) => k === 'reveal').length, 1);
  assert.match(reveal.transformation.after, /decay_exposed/);
  assert.equal(vanity.transformation.before, reveal.transformation.after);
  assert.ok(reveal.staged_success_clue, 'the reveal must carry the staged-success clue');
  assert.equal(typeof reveal.staged_success_clue.id, 'string');
  assert.equal(typeof reveal.staged_success_clue.proves, 'string');
  assert.deepEqual(reveal.requires, ['strip_deck']);

  // visible_proof now spans the expanded two-area route through safe discovery.
  assert.equal(descriptor.visible_proof.after, stepById('safe_receipt_clue').transformation.after);
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
  assert.deepEqual(choice.requires, ['safe_receipt_clue']);
  assert.equal(choice.evidence_object, 'staging_evidence_bundle');
});

test('the visible proof contrasts the staged gold set with the final evidence-exposed state', () => {
  assert.equal(descriptor.visible_proof.before, descriptor.set.initial_state);
  assert.equal(descriptor.visible_proof.after, stepById('safe_receipt_clue').transformation.after);
  assert.notEqual(descriptor.visible_proof.before, descriptor.visible_proof.after);
});

test('a next-zone hook is declared without building the third zone', () => {
  assert.equal(typeof descriptor.next_hook.label, 'string');
  const futureZoneSteps = descriptor.steps.filter((s) => /wardrobe_studio|third_zone/.test(s.id));
  assert.equal(futureZoneSteps.length, 0, 'the hook must not add the third playable zone');
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

test('evidence disposition before the safe receipt is blocked by name', () => {
  const path = descriptor.invalid_paths.find((p) => p.id === 'disposition_before_safe_receipt');
  assert.ok(path, 'expanded scenario must declare the disposition-before-receipt invalid path');
  const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
  assert.ok(blocked, 'dispositioning evidence before the safe receipt must be blocked');
  assert.deepEqual(blocked.missing, path.expect_missing);
  assert.deepEqual(path.expect_missing, ['safe_receipt_clue']);
  assert.equal(typeof path.requirement, 'string');
  assert.notEqual(path.requirement.trim(), '');
});

test('safe receipt discovery before vanity restoration is blocked by name', () => {
  const path = descriptor.invalid_paths.find((p) => p.id === 'safe_receipt_before_vanity_cleanup');
  assert.ok(path);
  const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
  assert.ok(blocked);
  assert.deepEqual(blocked.missing, ['restore_glamour_vanity']);
});

test('exiting with debris remaining is blocked by name', () => {
  const path = descriptor.invalid_paths.find((p) => p.id === 'exit_with_debris_remaining');
  const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
  assert.ok(blocked, 'the reveal must be blocked while cleaning passes remain');
  assert.deepEqual(blocked.missing, path.expect_missing);

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
    kinds().filter((k) => k === 'core_action').length >= 5,
    'debris plus three courtyard passes plus the glamour vanity restoration means at least five core actions',
  );
});
