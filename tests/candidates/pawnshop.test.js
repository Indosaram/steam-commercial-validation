/**
 * Task 6 - PANIC! AT THE PAWNSHOP candidate tests.
 *
 * Owned by the pawnshop candidate. Runs against the REAL descriptor on disk
 * (candidates/panic_at_the_pawnshop/scenario.js) through the SHARED contract
 * (core/candidate.js), so this suite fails if either the candidate content or
 * its integration with the foundation regresses.
 *
 * Run:
 *   node --test tests/candidates/pawnshop.test.js
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
import { runReplay, ITEM_IDS, EVIDENCE_TOOLS } from '../../candidates/panic_at_the_pawnshop/replay.js';

const CONCEPT = 'panic_at_the_pawnshop';

/** Load once; every test asserts against the real on-disk descriptor. */
const descriptor = await loadCandidateScenario(CONCEPT);

// ------------------------------------------------------- shared contract

test('the pawnshop candidate ships an on-disk descriptor', () => {
  assert.equal(hasCandidateScenario(CONCEPT), true);
  assert.ok(descriptor, 'loadCandidateScenario must return the descriptor');
  assert.equal(descriptor.concept_id, CONCEPT);
});

test('the descriptor satisfies the shared foundation contract', () => {
  const r = validateDescriptor(descriptor, CONCEPT);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test('the descriptor declares the six required shared beats', () => {
  const kinds = descriptor.steps.map((s) => s.kind);
  assert.ok(kinds.filter((k) => k === 'core_action').length >= 3, 'at least three core actions');
  assert.equal(kinds.includes('reveal'), true, 'signature reveal present');
  assert.equal(kinds.includes('choice'), true, 'meaningful choice present');
  assert.equal(kinds.includes('inspect'), true, 'inspect present');
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
  assert.equal(new Set(descriptor.replay).size, descriptor.replay.length, 'no repeated replay ids');
});

test('the replay order never violates a declared prerequisite', () => {
  const done = [];
  for (const id of descriptor.replay) {
    const blocked = blockedSteps(descriptor, done).find((b) => b.id === id);
    assert.equal(blocked, undefined, `replay step ${id} blocked by ${blocked?.missing?.join(', ')}`);
    done.push(id);
  }
  assert.equal(blockedSteps(descriptor, done).length, 0, 'nothing left blocked after replay');
});

// -------------------------------------------------- appraisal loop shape

test('the shift covers exactly three items', () => {
  assert.equal(ITEM_IDS.length, 3);
  for (const itemId of ITEM_IDS) {
    const steps = descriptor.steps.filter((s) => s.item === itemId);
    assert.ok(steps.length > 0, `item ${itemId} has steps`);
  }
});

test('every item is inspected with at least two distinct evidence tools', () => {
  for (const itemId of ITEM_IDS) {
    const tools = descriptor.steps
      .filter((s) => s.item === itemId && s.kind === 'inspect' && s.tool)
      .map((s) => s.tool);
    assert.ok(
      new Set(tools).size >= 2,
      `item ${itemId} used tools [${tools.join(', ')}]; the shift requires at least two distinct tools`,
    );
    for (const tool of tools) {
      assert.ok(EVIDENCE_TOOLS.includes(tool), `unknown evidence tool ${tool}`);
    }
  }
});

test('UV is one of the evidence tools actually used on every item', () => {
  for (const itemId of ITEM_IDS) {
    const tools = descriptor.steps.filter((s) => s.item === itemId && s.kind === 'inspect').map((s) => s.tool);
    assert.ok(tools.includes('uv_lamp'), `item ${itemId} must be inspected under UV`);
  }
});

test('every evidence step records a legible finding, never a hidden answer', () => {
  const evidenceSteps = descriptor.steps.filter((s) => s.kind === 'inspect' && s.tool);
  assert.ok(evidenceSteps.length >= 6, 'three items x two tools minimum');
  for (const step of evidenceSteps) {
    assert.equal(typeof step.finding, 'string', `${step.id} must record a finding`);
    assert.ok(step.finding.length > 20, `${step.id} finding must be legible, got "${step.finding}"`);
    assert.ok(
      ['authentic', 'forged', 'value', 'provenance'].includes(step.evidence_kind),
      `${step.id} evidence_kind ${step.evidence_kind} must be a declared kind`,
    );
  }
});

test('each appraisal is a core action gated behind that item own two evidence steps', () => {
  for (const itemId of ITEM_IDS) {
    const appraisal = descriptor.steps.find((s) => s.item === itemId && s.kind === 'core_action');
    assert.ok(appraisal, `item ${itemId} has an appraisal core action`);
    const evidenceIds = descriptor.steps
      .filter((s) => s.item === itemId && s.kind === 'inspect')
      .map((s) => s.id);
    for (const evidenceId of evidenceIds) {
      assert.ok(
        appraisal.requires.includes(evidenceId),
        `appraisal ${appraisal.id} must require evidence ${evidenceId}`,
      );
    }
  }
});

test('an appraisal is blocked by name until its evidence exists (no evidence, no appraisal)', () => {
  for (const itemId of ITEM_IDS) {
    const appraisal = descriptor.steps.find((s) => s.item === itemId && s.kind === 'core_action');
    const evidenceIds = descriptor.steps
      .filter((s) => s.item === itemId && s.kind === 'inspect')
      .map((s) => s.id);

    // Nothing done at all: appraisal blocked, missing list names the evidence.
    const blockedCold = blockedSteps(descriptor, []).find((b) => b.id === appraisal.id);
    assert.ok(blockedCold, `${appraisal.id} must be blocked from a cold start`);
    for (const evidenceId of evidenceIds) {
      assert.ok(
        blockedCold.missing.includes(evidenceId),
        `${appraisal.id} blocked message must name missing evidence ${evidenceId}`,
      );
    }

    // Only ONE tool used: still blocked, because one tool is not corroboration.
    const partial = descriptor.replay.slice(0, descriptor.replay.indexOf(evidenceIds[1]));
    const blockedPartial = blockedSteps(descriptor, partial).find((b) => b.id === appraisal.id);
    assert.ok(blockedPartial, `${appraisal.id} must stay blocked with only one tool used`);
    assert.deepEqual(blockedPartial.missing, [evidenceIds[1]]);
  }
});

test('the authored fake and the legitimate item are both resolvable from recorded evidence', () => {
  const verdicts = descriptor.items.map((i) => i.truth);
  assert.ok(verdicts.includes('forged'), 'the shift must contain an authored fake');
  assert.ok(verdicts.includes('authentic'), 'the shift must contain a legitimate item');

  for (const item of descriptor.items) {
    const evidence = descriptor.steps.filter((s) => s.item === item.item_id && s.kind === 'inspect');
    const supporting = evidence.filter((s) => s.supports === item.truth);
    assert.ok(
      supporting.length >= 1,
      `item ${item.item_id} (${item.truth}) needs at least one finding that supports its truth`,
    );
    assert.ok(
      item.correct_appraisal && item.correct_disposition,
      `item ${item.item_id} must declare the evidence-supported appraisal/disposition`,
    );
  }
});

test('the legitimate item is meaningful rather than merely valuable', () => {
  const authentic = descriptor.items.filter((i) => i.truth === 'authentic');
  assert.ok(
    authentic.some((i) => i.meaning && i.meaning.length > 20),
    'at least one authentic item must carry legible human meaning, not just a price',
  );
});

test('the reveal exposes manufactured scarcity and the hook seeds the next shift', () => {
  const reveal = descriptor.steps.find((s) => s.kind === 'reveal');
  assert.ok(reveal, 'reveal step exists');
  assert.match(reveal.label + ' ' + (reveal.finding ?? ''), /scarcit/i);
  assert.ok(reveal.requires.length >= 1, 'the reveal must be earned, not free');
  assert.equal(typeof descriptor.next_shift_hook, 'string');
  assert.ok(descriptor.next_shift_hook.length > 20, 'next-shift hook must be legible');
});

test('the reveal is gated behind all three appraisals', () => {
  const reveal = descriptor.steps.find((s) => s.kind === 'reveal');
  const appraisalIds = descriptor.steps
    .filter((s) => s.kind === 'core_action')
    .map((s) => s.id);
  const done = descriptor.replay.slice(0, descriptor.replay.indexOf(reveal.id));
  for (const id of appraisalIds) {
    assert.ok(done.includes(id), `reveal must follow appraisal ${id}`);
  }
  const withoutLast = done.filter((id) => id !== appraisalIds[appraisalIds.length - 1]);
  const blocked = blockedSteps(descriptor, withoutLast).find((b) => b.id === reveal.id);
  assert.ok(blocked, 'reveal must be blocked while an appraisal is outstanding');
});

test('committing an appraisal shows a consequence for each item', () => {
  for (const item of descriptor.items) {
    assert.ok(item.consequence, `item ${item.item_id} must declare a consequence`);
    assert.ok(item.consequence.length > 20, `item ${item.item_id} consequence must be legible`);
  }
});

test('every appraisal declares a visible before/after transformation', () => {
  for (const step of descriptor.steps.filter((s) => s.kind === 'core_action')) {
    assert.ok(step.transformation, `${step.id} must declare a transformation`);
    assert.notEqual(step.transformation.before, step.transformation.after);
  }
});

// --------------------------------------------- contradiction consequence

test('a contradicting appraisal is named and recoverable, never opaque randomness', () => {
  for (const item of descriptor.items) {
    const contradiction = item.contradiction;
    assert.ok(contradiction, `item ${item.item_id} must define its contradicting verdict`);
    assert.notEqual(contradiction.appraisal, item.correct_appraisal);
    assert.ok(contradiction.name, 'the consequence must be NAMED');
    assert.ok(
      contradiction.explanation && contradiction.explanation.length > 20,
      'the consequence must be explained in legible text',
    );
    assert.equal(contradiction.recoverable, true, 'the consequence must be recoverable');
    assert.ok(contradiction.recovery, 'the recovery path must be stated');
    assert.ok(
      contradiction.contradicts && contradiction.contradicts.length >= 1,
      'the consequence must cite the evidence it contradicts',
    );
    for (const evidenceId of contradiction.contradicts) {
      assert.ok(
        descriptor.steps.some((s) => s.id === evidenceId),
        `contradiction cites unknown evidence step ${evidenceId}`,
      );
    }
  }
});

test('no scenario outcome depends on randomness', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../candidates/panic_at_the_pawnshop/replay.js', import.meta.url), 'utf8'),
  );
  const descriptorSrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../candidates/panic_at_the_pawnshop/scenario.js', import.meta.url), 'utf8'),
  );
  for (const [name, text] of [['replay.js', src], ['scenario.js', descriptorSrc]]) {
    assert.doesNotMatch(text, /Math\.random/, `${name} must not use Math.random`);
    assert.doesNotMatch(text, /\bDate\.now\b/, `${name} must not branch on wall-clock time`);
  }
});

test('the candidate declares no marketplace, trading, or gambling mechanics', async () => {
  const fs = await import('node:fs');
  const files = ['scenario.js', 'replay.js'];
  const forbidden = [/gacha/i, /lootbox/i, /wishlist/i, /steam(works|api)/i, /real[-_ ]money/i, /\bwager\b/i];
  for (const file of files) {
    const text = fs.readFileSync(
      new URL(`../../candidates/panic_at_the_pawnshop/${file}`, import.meta.url),
      'utf8',
    );
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} must not contain ${pattern}`);
    }
  }
});

// ------------------------------------------------------- replay driver

test('the deterministic replay completes the shift and emits the shared events', () => {
  const run = runReplay({ seed: 1 });
  const names = run.events.map((e) => e.event);
  for (const required of [
    'session_started',
    'core_action_completed',
    'signature_reveal_seen',
    'choice_committed',
    'scenario_completed',
    'session_ended',
  ]) {
    assert.ok(names.includes(required), `replay missing required event ${required}`);
  }
  assert.equal(names.filter((n) => n === 'core_action_completed').length, 3, 'three appraisals');
  assert.ok(names.includes('next_hook_shown'), 'next-shift hook must be shown');
  assert.equal(run.ok, true, JSON.stringify(run.failures));
});

test('the replay is deterministic across runs', () => {
  const a = runReplay({ seed: 1 });
  const b = runReplay({ seed: 1 });
  assert.deepEqual(
    a.events.map((e) => ({ e: e.event, t: e.t_ms, p: e.payload })),
    b.events.map((e) => ({ e: e.event, t: e.t_ms, p: e.payload })),
  );
  assert.equal(a.session_id, b.session_id);
});

test('the replay lands inside the shared 10-15 minute target window', () => {
  const run = runReplay({ seed: 1 });
  const minutes = run.active_ms / 60000;
  assert.ok(minutes >= 10 && minutes <= 15, `active play was ${minutes.toFixed(2)} minutes`);
  const concept = getConcept(CONCEPT);
  assert.equal(concept.target_minutes.min, 10);
  assert.equal(concept.target_minutes.max, 15);
});

test('the replay telemetry validates against the shared schema', async () => {
  const { validateSession } = await import('../../core/telemetry.js');
  const run = runReplay({ seed: 1 });
  const r = validateSession(run.events);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('the replay satisfies the shared success condition', async () => {
  const { evaluateSuccessCondition } = await import('../../core/shell-core.js');
  const run = runReplay({ seed: 1 });
  const success = evaluateSuccessCondition({ events: run.events, active_ms: run.active_ms });
  assert.equal(success.ok, true, JSON.stringify(success.checks));
});

// ---------------------------------------------- invalid-path replay mode

test('replay in unsupported-appraisal mode is blocked before any appraisal lands', () => {
  const run = runReplay({ seed: 1, mode: 'appraise_without_evidence' });
  const blocked = run.events.filter((e) => e.event === 'invalid_action_blocked');
  assert.ok(blocked.length >= 1, 'an unsupported appraisal must be blocked');
  assert.equal(
    run.events.some((e) => e.event === 'core_action_completed'),
    false,
    'no appraisal may land without evidence',
  );
  for (const b of blocked) {
    assert.ok(b.payload.missing?.length >= 1, 'the block must name the missing evidence');
    assert.equal(b.payload.reason, 'evidence_missing');
  }
  assert.equal(run.ok, false, 'the shift must not complete from an unsupported appraisal');
});

test('replay in contradicting mode produces a named recoverable consequence and still completes', () => {
  const run = runReplay({ seed: 1, mode: 'contradict_evidence' });
  const contradicted = run.events.filter(
    (e) => e.event === 'core_action_completed' && e.payload.contradicts_evidence,
  );
  assert.ok(contradicted.length >= 1, 'the contradicting appraisal must still be committed');
  for (const e of contradicted) {
    assert.ok(e.payload.consequence_name, 'the consequence must be named');
    assert.ok(e.payload.consequence_explanation.length > 20, 'the consequence must be explained');
    assert.equal(e.payload.recoverable, true);
    assert.ok(e.payload.contradicted_evidence.length >= 1, 'the contradicted evidence must be cited');
  }
  assert.equal(
    run.events.some((e) => e.event === 'scenario_completed'),
    true,
    'a contradiction is a consequence, not a soft-lock',
  );
  assert.ok(run.outcomes.some((o) => o.consequence_applied), 'the outcome export records the consequence');
});

test('the contradiction consequence differs from the evidence-supported outcome', () => {
  const good = runReplay({ seed: 1 });
  const bad = runReplay({ seed: 1, mode: 'contradict_evidence' });
  assert.notDeepEqual(
    good.outcomes.map((o) => o.appraisal),
    bad.outcomes.map((o) => o.appraisal),
    'contradicting the evidence must change the recorded outcome',
  );
  assert.equal(good.outcomes.every((o) => o.evidence_supported), true);
  assert.equal(bad.outcomes.some((o) => !o.evidence_supported), true);
});
