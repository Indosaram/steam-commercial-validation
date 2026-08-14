/**
 * CURSED SECONDHAND (Task 5) candidate tests.
 *
 * Owned by the cursed_secondhand candidate. These assert the candidate's own
 * descriptor against the SHARED contract - they do not reimplement validation
 * and do not touch core/, shell/, or tools/.
 *
 * What is deliberately NOT tested here: prose. Labels, detail text, and the
 * hook sentence are authored content, not machine-consumed values, so pinning
 * their wording would only manufacture churn. Structure, gating, tool
 * distinctness, event mapping, and timing ARE machine-consumed and are tested.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateDescriptor,
  blockedSteps,
  loadCandidateScenario,
  hasCandidateScenario,
  descriptorPath,
  STEP_KINDS,
} from '../../core/candidate.js';
import { buildIdentity, checkCandidateIsolation } from '../../core/build-identity.js';
import { getConcept } from '../../core/concepts.js';
import { validateSession } from '../../core/telemetry.js';
import { runReplay } from '../../candidates/cursed_secondhand/replay.js';

const CONCEPT = 'cursed_secondhand';

/** Load the real on-disk descriptor once, through the shared loader. */
const descriptor = await loadCandidateScenario(CONCEPT);

// ------------------------------------------------------- shared contract

test('the candidate ships an on-disk descriptor the shared loader accepts', () => {
  assert.equal(hasCandidateScenario(CONCEPT), true);
  assert.ok(descriptor, 'loadCandidateScenario must return the descriptor');
  const r = validateDescriptor(descriptor, CONCEPT);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('the descriptor declares its own concept and stays in its own directory', () => {
  assert.equal(descriptor.concept_id, CONCEPT);
  assert.ok(descriptorPath(CONCEPT).endsWith(`candidates/${CONCEPT}/scenario.js`));
});

test('the candidate imports no other candidate module', () => {
  const r = checkCandidateIsolation();
  assert.equal(r.ok, true, `isolation violations: ${r.violations.join('; ')}`);
  const src = readFileSync(descriptorPath(CONCEPT), 'utf8');
  assert.doesNotMatch(src, /from\s+['"].*candidates\//, 'descriptor must not import a sibling candidate');
});

test('the candidate has a distinct build identity from the empty foundation', () => {
  const identity = buildIdentity(CONCEPT);
  assert.equal(identity.candidate_present, true);
  assert.equal(typeof identity.candidate_hash, 'string');
  assert.ok(identity.source_files >= 1);
  assert.ok(identity.build_id.includes(CONCEPT));
});

// --------------------------------------------------- required scenario beats

test('the scenario is one diagnostic, three restorations, a clue, a reveal, and a choice', () => {
  const kinds = descriptor.steps.map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'core_action').length, 3, 'exactly three restoration passes');
  assert.equal(kinds.filter((k) => k === 'reveal').length, 1);
  assert.equal(kinds.filter((k) => k === 'choice').length, 1);
  assert.equal(kinds.filter((k) => k === 'inspect').length, 2, 'diagnosis and the memory clue');
});

test('the three restoration actions are distinct: different tool, different restored property', () => {
  const passes = descriptor.steps.filter((s) => s.kind === 'core_action');
  const tools = passes.map((s) => s.tool);
  const restored = passes.map((s) => s.restores);
  assert.equal(new Set(tools).size, 3, `tools must differ, got ${tools.join(', ')}`);
  assert.equal(new Set(restored).size, 3, `restored properties must differ, got ${restored.join(', ')}`);
  for (const tool of tools) assert.ok(typeof tool === 'string' && tool.length > 0);
});

test('every restoration pass declares a visible before/after transformation', () => {
  for (const step of descriptor.steps.filter((s) => s.kind === 'core_action')) {
    assert.ok(step.transformation, `${step.id} must declare a transformation`);
    assert.notEqual(
      step.transformation.before,
      step.transformation.after,
      `${step.id} transformation must actually change state`,
    );
  }
});

test('every step declares a visible before/after transformation, not only the core actions', () => {
  for (const step of descriptor.steps) {
    assert.ok(step.transformation, `${step.id} must declare a transformation`);
    assert.notEqual(step.transformation.before, step.transformation.after, step.id);
  }
});

test('the diagnostic separates dust, damage, and curse traces', () => {
  const kinds = descriptor.traces.map((t) => t.kind);
  assert.deepEqual([...kinds].sort(), ['curse', 'damage', 'dust']);
  for (const t of descriptor.traces) {
    assert.ok(typeof t.reading === 'string' && t.reading.length > 0, `${t.kind} needs a reading`);
  }
});

test('the personal-memory clue is a discovery step carrying a named clue', () => {
  const clue = descriptor.steps.find((s) => s.id === 'memory_clue');
  assert.ok(clue, 'the scenario must contain a memory clue step');
  assert.equal(clue.kind, 'inspect');
  assert.ok(typeof clue.clue === 'string' && clue.clue.length > 0);
});

test('the reveal is a brief interior-space opening that is reversible', () => {
  const reveal = descriptor.steps.find((s) => s.kind === 'reveal');
  assert.equal(reveal.reversible, true, 'the reveal must be reversible');
  assert.equal(
    reveal.reverts_to,
    reveal.transformation.before,
    'the reveal must revert to the state it opened from',
  );
});

test('the disposition offers exactly return, archive, and seal, each with a consequence', () => {
  const choice = descriptor.steps.find((s) => s.kind === 'choice');
  const ids = choice.options.map((o) => o.id);
  assert.deepEqual([...ids].sort(), ['archive', 'return', 'seal']);
  assert.ok(ids.includes(choice.default_option), 'deterministic replay disposition must be a real option');
  for (const option of choice.options) {
    assert.ok(typeof option.consequence === 'string' && option.consequence.length > 0, option.id);
  }
});

test('a next-intake hook is declared without shipping a second restorable item', () => {
  assert.ok(descriptor.next_hook?.text, 'a next-scenario hook is required');
  // Scope guard: one item only. No second item may appear as a playable step.
  const stepIds = descriptor.steps.map((s) => s.id);
  assert.equal(
    stepIds.some((id) => /0418/.test(id)),
    false,
    'the second intake must stay a hook, not a second restorable item',
  );
});

test('the build stays a single-item workshop: no shop economy or generator', () => {
  const src = readFileSync(descriptorPath(CONCEPT), 'utf8');
  for (const banned of [/Math\.random/, /\bgacha\b/i, /\bwishlist\b/i, /marketplace/i, /steam(works|api)/i]) {
    assert.doesNotMatch(src, banned, `descriptor must not contain ${banned}`);
  }
  assert.equal(descriptor.steps.filter((s) => s.kind === 'core_action').length, 3,
    'three authored passes, not a repeatable generated loop');
});

// ------------------------------------------------------- ordered gating

test('the replay order covers every step exactly once and is fully unblocked', () => {
  const stepIds = descriptor.steps.map((s) => s.id);
  assert.deepEqual([...descriptor.replay].sort(), [...stepIds].sort(), 'replay must cover all steps');
  assert.equal(new Set(descriptor.replay).size, descriptor.replay.length, 'no repeats in replay');

  // Walking the replay must never hit a blocked step.
  const done = [];
  for (const id of descriptor.replay) {
    const blocked = blockedSteps(descriptor, done).find((b) => b.id === id);
    assert.equal(blocked, undefined, `${id} was blocked during a valid replay: ${JSON.stringify(blocked)}`);
    done.push(id);
  }
  assert.equal(blockedSteps(descriptor, done).length, 0, 'nothing remains blocked after a full replay');
});

test('the reveal is unreachable until diagnosis and all three tool passes are done', () => {
  const prefixes = [
    [],
    ['diagnose'],
    ['diagnose', 'dust_pass'],
    ['diagnose', 'dust_pass', 'solder_pass'],
    ['diagnose', 'dust_pass', 'solder_pass', 'trace_pass'],
  ];
  for (const completed of prefixes) {
    const blocked = blockedSteps(descriptor, completed).find((b) => b.id === 'interior_reveal');
    assert.ok(blocked, `reveal must stay blocked after [${completed.join(', ')}]`);
    assert.ok(blocked.missing.length > 0, 'a blocked reveal must name what is missing');
  }
  const full = ['diagnose', 'dust_pass', 'solder_pass', 'trace_pass', 'memory_clue'];
  assert.equal(blockedSteps(descriptor, full).find((b) => b.id === 'interior_reveal'), undefined);
});

test('each declared invalid path is denied with the exact missing prerequisite', () => {
  assert.ok(descriptor.invalid_paths.length >= 3, 'the candidate must declare its invalid paths');
  for (const path of descriptor.invalid_paths) {
    const blocked = blockedSteps(descriptor, path.completed).find((b) => b.id === path.attempt);
    assert.ok(blocked, `${path.id}: "${path.attempt}" should have been denied`);
    assert.deepEqual(
      blocked.missing,
      path.expect_missing,
      `${path.id}: denial must name the actionable missing step`,
    );
  }
});

test('a denied step is never soft-locked: doing the named prerequisite unblocks it', () => {
  for (const path of descriptor.invalid_paths) {
    // Complete exactly what the denial named, then re-check reachability.
    const recovered = [...path.completed];
    // Walk the replay forward, adding the missing steps in their declared order.
    for (const id of descriptor.replay) {
      if (id === path.attempt) break;
      if (!recovered.includes(id)) recovered.push(id);
    }
    const stillBlocked = blockedSteps(descriptor, recovered).find((b) => b.id === path.attempt);
    assert.equal(
      stillBlocked,
      undefined,
      `${path.id}: attempting the named prerequisites must unblock "${path.attempt}", not soft-lock it`,
    );
  }
});

test('no step depends on a later step (no unsatisfiable prerequisite)', () => {
  const order = descriptor.steps.map((s) => s.id);
  descriptor.steps.forEach((step, i) => {
    for (const req of step.requires ?? []) {
      assert.ok(order.indexOf(req) < i, `${step.id} requires later step ${req}`);
    }
  });
});

// --------------------------------------------------- event + timing mapping

test('the step kinds map onto the six shared required events', () => {
  const emitted = new Set(descriptor.steps.map((s) => STEP_KINDS[s.kind]));
  for (const required of ['core_action_completed', 'signature_reveal_seen', 'choice_committed']) {
    assert.ok(emitted.has(required), `no step emits ${required}`);
  }
  assert.ok(emitted.has('inspect_performed'), 'the diagnostic must emit inspect_performed');
});

test('scripted step durations land the session inside the 10-15 minute window', () => {
  const total = descriptor.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
  const minutes = total / 60000;
  assert.ok(minutes >= 10 && minutes <= 15, `scripted active play is ${minutes.toFixed(2)} min, outside 10-15`);
});

test('the descriptor matches its frozen concept definition', () => {
  const concept = getConcept(CONCEPT);
  assert.equal(concept.concept_id, descriptor.concept_id);
  assert.equal(concept.target_minutes.min, 10);
  assert.equal(concept.target_minutes.max, 15);
});

// ------------------------------------------------ deterministic replay/export

test('the candidate replay is deterministic and validates against the shared schema', () => {
  const a = runReplay({ seed: 417 });
  const b = runReplay({ seed: 417 });
  assert.deepEqual(a.events, b.events);
  assert.equal(a.ok, true, a.failures.join('; '));
  assert.equal(validateSession(a.events).ok, true);
  assert.equal(a.success_condition.ok, true);
  assert.deepEqual(a.completed_steps, descriptor.replay);
});

test('the replay exports the three distinct restoration passes and personal-memory clue', () => {
  const run = runReplay({ seed: 417 });
  const passes = run.events.filter((event) => event.event === 'core_action_completed');
  assert.deepEqual(passes.map((event) => event.payload.tool), ['soft_brush', 'solder_iron', 'trace_salt']);
  assert.deepEqual(passes.map((event) => event.payload.restores), ['surface', 'movement', 'curse_trace']);
  const clue = run.events.find((event) => event.payload.step_id === 'memory_clue');
  assert.equal(clue.payload.personal_memory, true);
  assert.equal(clue.payload.clue, descriptor.steps.find((step) => step.id === 'memory_clue').clue);
});

test('the replay proves a reversible interior reveal, committed disposition, and next intake', () => {
  const run = runReplay({ seed: 417 });
  const reveal = run.events.find((event) => event.event === 'signature_reveal_seen');
  assert.equal(reveal.payload.interior_space, true);
  assert.equal(reveal.payload.reversible, true);
  assert.equal(reveal.payload.reverts_to, 'workshop_restored');

  const choice = run.events.find((event) => event.event === 'choice_committed');
  assert.deepEqual(choice.payload.available_options, ['return', 'archive', 'seal']);
  assert.equal(choice.payload.option, 'archive');

  const hook = run.events.find((event) => event.event === 'next_hook_shown');
  assert.equal(hook.payload.intake_id, descriptor.next_hook.id);
  assert.equal(typeof hook.payload.hook, 'string');
});

test('invalid-first blocks reveal, tools, disposition, and completion, then recovers in one session', () => {
  const run = runReplay({ seed: 417, invalidFirst: true });
  assert.equal(run.ok, true, run.failures.join('; '));
  const expected = {
    interior_reveal: ['memory_clue'],
    disposition: ['interior_reveal'],
    dust_pass: ['diagnose'],
  };
  for (const [attempted, missing] of Object.entries(expected)) {
    const block = run.blocked.find((entry) => entry.attempted === attempted);
    assert.ok(block, `${attempted} must be blocked`);
    assert.deepEqual(block.missing, missing);
    assert.match(block.recovery, /complete .* then retry/);
  }

  const names = run.events.map((event) => event.event);
  const premature = run.events.find(
    (event) => event.event === 'invalid_action_blocked' && event.payload.attempted === 'scenario_completed',
  );
  assert.ok(premature, 'completion must be denied while prerequisites remain');
  assert.ok(premature.payload.missing.includes('diagnose'));
  assert.equal(names.filter((name) => name === 'scenario_completed').length, 1);
  assert.ok(names.lastIndexOf('invalid_action_blocked') < names.indexOf('scenario_completed'));
  assert.equal(validateSession(run.events).ok, true);
});
