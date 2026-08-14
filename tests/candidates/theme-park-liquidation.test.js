/**
 * Candidate proof: THEME PARK LIQUIDATION (Task 4).
 *
 * These tests assert the candidate-specific requirements the shared contract
 * cannot know about:
 *
 *   - one sealed souvenir shop PLUS one parade-float/show-control space
 *   - triage failed merchandise, clear the guest path, repair one
 *     mechanical/electrical show component
 *   - discover the failed collectible-boom clue
 *   - make one restoration/display/disposal decision
 *   - start a short recovered mascot show, then a next-attraction hook
 *   - the show can ONLY start once the guest path is clear AND the show
 *     control is repaired; attempting it earlier yields a NAMED blocked state
 *     and produces no completion
 *
 * They deliberately drive the SAME code the launcher and browser shell use
 * (core/candidate.js + core/scenario-contract.js), not a private copy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCandidateScenario } from '../../core/candidate.js';
import { validateDescriptor, blockedSteps, STEP_KINDS } from '../../core/scenario-contract.js';
import { getConcept } from '../../core/concepts.js';
import { buildIdentity, checkCandidateIsolation } from '../../core/build-identity.js';
import { runReplay } from '../../candidates/theme_park_liquidation/replay.js';

const CONCEPT = 'theme_park_liquidation';

/** Load once: every test asserts against the real on-disk descriptor. */
const descriptor = await loadCandidateScenario(CONCEPT);

const byId = (id) => descriptor.steps.find((s) => s.id === id);
const idsOf = (kind) => descriptor.steps.filter((s) => s.kind === kind).map((s) => s.id);

/** Walk the declared replay, rejecting any step whose prerequisites are unmet. */
function walkReplay(order) {
  const done = [];
  for (const id of order) {
    const step = byId(id);
    assert.ok(step, `replay references unknown step ${id}`);
    const blocked = blockedSteps(descriptor, done).find((b) => b.id === id);
    assert.equal(blocked, undefined, `replay step ${id} was blocked: missing ${blocked?.missing?.join(', ')}`);
    done.push(id);
  }
  return done;
}

// ------------------------------------------------------- shared conformance

test('the descriptor exists and satisfies the shared candidate contract', () => {
  assert.ok(descriptor, 'candidates/theme_park_liquidation/scenario.js must default-export a descriptor');
  const r = validateDescriptor(descriptor, CONCEPT);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  assert.equal(descriptor.concept_id, CONCEPT);
});

test('the descriptor binds to the frozen concept registry rather than inventing its own copy', () => {
  const concept = getConcept(CONCEPT);
  assert.equal(concept.title, 'THEME PARK LIQUIDATION');
  // The candidate must not restate the shared reveal/choice/hook strings under
  // different wording: the comparison depends on one shared vocabulary.
  assert.match(concept.signature_reveal, /collectible boom/i);
  assert.match(concept.next_hook, /second sealed attraction/i);
});

test('this candidate produces its own distinct build identity', () => {
  const identity = buildIdentity(CONCEPT);
  assert.equal(identity.candidate_present, true, 'candidate sources must be captured by the build hash');
  assert.ok(identity.source_files >= 1);
  assert.match(identity.build_id, /^foundation-\d+\.\d+\.\d+\+theme_park_liquidation\.[0-9a-f]{12}$/);
});

test('the candidate imports no other candidate (isolation)', () => {
  const r = checkCandidateIsolation();
  assert.equal(r.ok, true, r.violations.join('; '));
});

// -------------------------------------------------------- scenario coverage

test('the scenario covers both authored spaces: sealed souvenir shop and show-control space', () => {
  const spaces = new Set(descriptor.steps.map((s) => s.space));
  assert.ok(spaces.has('souvenir_shop'), 'no step takes place in the sealed souvenir shop');
  assert.ok(spaces.has('show_control'), 'no step takes place in the parade-float/show-control space');
  assert.equal(spaces.size, 2, `scope cap: exactly two spaces, got ${[...spaces].join(', ')}`);
  for (const step of descriptor.steps) {
    assert.ok(step.space, `step ${step.id} does not declare which space it happens in`);
  }
});

test('the scenario triages failed merchandise, clears the guest path, and repairs the show control', () => {
  const beats = new Set(descriptor.steps.map((s) => s.beat));
  for (const required of ['merch_triage', 'path_clear', 'control_repair', 'show_start']) {
    assert.ok(beats.has(required), `scenario is missing the required beat: ${required}`);
  }
  // Triage/clear/repair are the repeated hands-on work, so they must be core actions.
  for (const beat of ['merch_triage', 'path_clear', 'control_repair']) {
    const steps = descriptor.steps.filter((s) => s.beat === beat);
    assert.ok(steps.length >= 1, `beat ${beat} has no steps`);
    for (const s of steps) {
      assert.equal(s.kind, 'core_action', `${s.id} (${beat}) must be a core_action, got ${s.kind}`);
    }
  }
  assert.ok(idsOf('core_action').length >= 3, 'the shared contract needs at least three core actions');
});

test('every step declares ordered prerequisites and a visible before/after transformation', () => {
  descriptor.steps.forEach((step, i) => {
    if (i === 0) {
      assert.deepEqual(step.requires ?? [], [], 'the opening step must be reachable from a cold start');
    } else {
      assert.ok(
        Array.isArray(step.requires) && step.requires.length > 0,
        `step ${step.id} declares no prerequisite, so the scenario order is not enforced`,
      );
    }
    assert.ok(step.transformation, `step ${step.id} has no visible transformation`);
    assert.notEqual(
      step.transformation.before,
      step.transformation.after,
      `step ${step.id} transformation is not visible: before === after`,
    );
  });
});

test('the collectible-boom clue is the signature reveal and follows the hands-on work', () => {
  const reveals = descriptor.steps.filter((s) => s.kind === 'reveal');
  assert.equal(reveals.length, 1, 'exactly one signature reveal');
  const reveal = reveals[0];
  assert.match(`${reveal.label} ${reveal.detail ?? ''}`, /collectible/i);
  assert.equal(STEP_KINDS[reveal.kind], 'signature_reveal_seen');
  // Discovered by working the merch, not handed over at the door.
  const merch = descriptor.steps.filter((s) => s.beat === 'merch_triage').map((s) => s.id);
  assert.ok(
    merch.some((m) => (reveal.requires ?? []).includes(m)),
    'the clue must be gated behind actually triaging merchandise',
  );
});

test('the restoration/display/disposal decision is a real three-way choice made after the clue', () => {
  const choices = descriptor.steps.filter((s) => s.kind === 'choice');
  assert.equal(choices.length, 1, 'exactly one meaningful choice');
  const choice = choices[0];
  const options = choice.options ?? [];
  assert.deepEqual(
    [...options.map((o) => o.id)].sort(),
    ['display', 'dispose', 'restore'],
    'the choice must offer restore / display / dispose',
  );
  for (const option of options) {
    assert.ok(option.label, `option ${option.id} needs a player-facing label`);
    assert.ok(option.outcome, `option ${option.id} needs a stated consequence`);
  }
  const revealId = descriptor.steps.find((s) => s.kind === 'reveal').id;
  assert.ok(
    (choice.requires ?? []).includes(revealId),
    'the disposition decision must not be committable before the clue is found',
  );
});

// ---------------------------------------------- the Task 4 gating requirement

test('starting the show requires BOTH a clear guest path and the repaired show control', () => {
  const show = descriptor.steps.find((s) => s.beat === 'show_start');
  assert.ok(show, 'no show-start step');

  const pathIds = idsOf('core_action').filter((id) => byId(id).beat === 'path_clear');
  const repairIds = idsOf('core_action').filter((id) => byId(id).beat === 'control_repair');
  assert.ok(pathIds.length > 0 && repairIds.length > 0);

  const reachable = (id, seen = new Set()) => {
    for (const req of byId(id)?.requires ?? []) {
      if (seen.has(req)) continue;
      seen.add(req);
      reachable(req, seen);
    }
    return seen;
  };
  const prereqs = reachable(show.id);

  for (const id of pathIds) {
    assert.ok(prereqs.has(id), `show start does not transitively require path step ${id}`);
  }
  for (const id of repairIds) {
    assert.ok(prereqs.has(id), `show start does not transitively require repair step ${id}`);
  }
});

test('invalid path: starting the show with a blocked path is refused by name and completes nothing', () => {
  const show = descriptor.steps.find((s) => s.beat === 'show_start');
  const pathIds = idsOf('core_action').filter((id) => byId(id).beat === 'path_clear');

  // Everything done EXCEPT clearing the guest path.
  const done = descriptor.steps
    .map((s) => s.id)
    .filter((id) => id !== show.id && !pathIds.includes(id));

  const blocked = blockedSteps(descriptor, done).find((b) => b.id === show.id);
  assert.ok(blocked, 'the show started with a blocked guest path');
  assert.ok(blocked.missing.length > 0, 'a blocked show must name what is missing');
  assert.ok(
    !done.includes(show.id),
    'no completion may be recorded for a show that never legally started',
  );
});

test('invalid path: starting the show without the repair parts is refused by name', () => {
  const show = descriptor.steps.find((s) => s.beat === 'show_start');
  const repairIds = idsOf('core_action').filter((id) => byId(id).beat === 'control_repair');

  const done = descriptor.steps
    .map((s) => s.id)
    .filter((id) => id !== show.id && !repairIds.includes(id));

  const blocked = blockedSteps(descriptor, done).find((b) => b.id === show.id);
  assert.ok(blocked, 'the show started without the show control repaired');
  assert.ok(blocked.missing.length > 0, 'a blocked show must name what is missing');
});

test('the repair itself is gated on recovering the parts, not free', () => {
  const repair = descriptor.steps.filter((s) => s.beat === 'control_repair');
  for (const step of repair) {
    assert.ok(
      (step.requires ?? []).length > 0,
      `${step.id} can be performed from a cold start, so "missing repair parts" is unreachable`,
    );
  }
  // From a cold start, only the opening step is available.
  const openable = descriptor.steps.filter((s) => (s.requires ?? []).length === 0).map((s) => s.id);
  assert.deepEqual(openable, [descriptor.steps[0].id]);
});

// ---------------------------------------------------------------- replay

test('the declared replay is a complete, legal, deterministic ordering', () => {
  assert.ok(Array.isArray(descriptor.replay), 'descriptor.replay is required for the replay driver');
  assert.deepEqual(
    [...descriptor.replay].sort(),
    [...descriptor.steps.map((s) => s.id)].sort(),
    'replay must cover every step exactly once',
  );
  const done = walkReplay(descriptor.replay);
  assert.equal(blockedSteps(descriptor, done).length, 0, 'replay leaves steps blocked');
});

test('the replay reaches the show only after the path and repair beats', () => {
  const order = descriptor.replay;
  const idx = (id) => order.indexOf(id);
  const show = descriptor.steps.find((s) => s.beat === 'show_start').id;
  for (const step of descriptor.steps) {
    if (step.beat === 'path_clear' || step.beat === 'control_repair') {
      assert.ok(idx(step.id) < idx(show), `${step.id} must be replayed before the show starts`);
    }
  }
});

test('the shell kind-ordering cannot reorder the scenario: same-kind steps stay in declared order', () => {
  // shell.js picks the FIRST pending step of a kind. That only preserves the
  // authored order if same-kind steps are declared in dependency order.
  for (const kind of ['inspect', 'core_action', 'reveal', 'choice']) {
    const sameKind = descriptor.steps.filter((s) => s.kind === kind).map((s) => s.id);
    const inReplay = descriptor.replay.filter((id) => sameKind.includes(id));
    assert.deepEqual(inReplay, sameKind, `${kind} steps are replayed out of declared order`);
  }
});

test('a simulated shell run emits the six required events in causal order', () => {
  // Mirrors shell.js runCandidateStep(): first pending step of the pressed kind.
  const done = [];
  const emitted = ['session_started'];
  const press = (kind) => {
    const step = descriptor.steps.find((s) => s.kind === kind && !done.includes(s.id));
    assert.ok(step, `no pending ${kind} step to press`);
    const blocked = blockedSteps(descriptor, done).find((b) => b.id === step.id);
    assert.equal(blocked, undefined, `pressing ${kind} hit blocked step ${step.id}`);
    done.push(step.id);
    emitted.push(STEP_KINDS[step.kind]);
  };

  for (const step of descriptor.steps) press(step.kind);
  emitted.push('scenario_completed', 'next_hook_shown', 'session_ended');

  for (const required of [
    'session_started',
    'core_action_completed',
    'signature_reveal_seen',
    'choice_committed',
    'scenario_completed',
    'session_ended',
  ]) {
    assert.ok(emitted.includes(required), `missing required event ${required}`);
  }
  assert.ok(
    emitted.indexOf('signature_reveal_seen') < emitted.indexOf('choice_committed'),
    'the clue must precede the disposition decision in the emitted stream',
  );
  assert.ok(
    emitted.indexOf('choice_committed') < emitted.indexOf('scenario_completed'),
  );
  assert.equal(done.length, descriptor.steps.length, 'a full press-through must complete every step');
});

// -------------------------------------------------------------- guardrails

test('the candidate declares no marketplace, gambling, or real-money mechanics', () => {
  const text = JSON.stringify(descriptor).toLowerCase();
  for (const banned of ['steam', 'wishlist', 'gacha', 'loot box', 'lootbox', 'gambling', 'marketplace', 'real money', 'microtransaction']) {
    assert.equal(text.includes(banned), false, `descriptor mentions banned mechanic: ${banned}`);
  }
});

test('the authored scenario fits the 10-15 minute window at the declared pace', () => {
  const total = descriptor.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
  const overhead = (descriptor.intro_ms ?? 0) + (descriptor.wrap_ms ?? 0);
  const minutes = (total + overhead) / 60000;
  assert.ok(minutes >= 10 && minutes <= 15, `authored pace is ${minutes.toFixed(2)} min, outside 10-15`);
});

test('the deterministic valid replay completes the show and next-attraction hook', () => {
  const run = runReplay({ mode: 'valid', seed: 424242, choice: 'display' });
  assert.equal(run.ok, true, run.failures.join('; '));
  assert.equal(run.completed_scenario, true);
  assert.equal(run.completed.length, descriptor.steps.length);
  const show = run.events.findIndex((event) => event.payload?.step_id === 'run_show');
  const path = run.events.findIndex((event) => event.payload?.step_id === 'clear_debris');
  const controls = run.events.findIndex((event) => event.payload?.step_id === 'reseat_fuse');
  assert.ok(show > path && show > controls, 'show must follow both path and control repairs');
  assert.ok(run.events.some((event) => event.event === 'next_hook_shown'));
});

test('deterministic invalid-first probes name the missing gate and never complete', () => {
  for (const [mode, missing] of [['blocked_path', 'clear_debris'], ['missing_controls', 'reseat_fuse']]) {
    const run = runReplay({ mode, seed: 424242 });
    assert.equal(run.ok, true, `${mode}: ${run.failures.join('; ')}`);
    assert.equal(run.blocked_as_expected, true);
    assert.equal(run.completed_scenario, false);
    assert.equal(run.events.some((event) => event.event === 'scenario_completed'), false);
    const blocked = run.events.find((event) => event.event === 'invalid_action_blocked');
    assert.ok(blocked.payload.missing.includes(missing), `${mode} did not name ${missing}`);
  }
});
