import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONCEPTS, CONCEPT_IDS, getConcept } from '../core/concepts.js';
import { INPUT_MAP, resolveInput } from '../core/input.js';
import { REQUIRED_EVENTS, EVENT_NAMES, validateEvent, validateSession } from '../core/telemetry.js';
import { createProfile, loadProfile, resetProfile, PROFILE_VERSION } from '../core/profile.js';
import { buildScorecard, validateScorecard } from '../core/scorecard.js';
import { buildDecisionRecord } from '../core/decision-log.js';
import { runScenario } from '../core/shell-core.js';

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'scv-test-'));
}

// ---------------------------------------------------------------- concepts

test('exactly five concept IDs are defined and stable', () => {
  assert.equal(CONCEPT_IDS.length, 5);
  assert.deepEqual(CONCEPT_IDS, [
    'fake_it_till_you_clean_it',
    'return_to_sender',
    'theme_park_liquidation',
    'cursed_secondhand',
    'panic_at_the_pawnshop',
  ]);
});

test('every concept declares the shared proof contract fields', () => {
  for (const id of CONCEPT_IDS) {
    const c = getConcept(id);
    assert.equal(c.concept_id, id);
    assert.ok(c.title.length > 0, `${id} title`);
    assert.ok(c.role.length > 0, `${id} role`);
    assert.ok(c.core_action.length > 0, `${id} core_action`);
    assert.ok(c.signature_reveal.length > 0, `${id} signature_reveal`);
    assert.ok(c.next_hook.length > 0, `${id} next_hook`);
    assert.equal(c.target_minutes.min, 10);
    assert.equal(c.target_minutes.max, 15);
  }
});

test('unknown concept id is rejected', () => {
  assert.throws(() => getConcept('not_a_concept'), /unknown concept_id/i);
});

// ---------------------------------------------------------------- input map

test('input map covers every shared verb on keyboard and gamepad', () => {
  for (const verb of ['interact', 'core_action', 'inspect', 'commit_choice', 'advance', 'reset_profile']) {
    assert.ok(INPUT_MAP[verb], `missing verb ${verb}`);
    assert.ok(INPUT_MAP[verb].keyboard.length > 0, `${verb} keyboard`);
    assert.ok(INPUT_MAP[verb].gamepad.length > 0, `${verb} gamepad`);
  }
});

test('input resolution maps a raw key to its shared verb', () => {
  assert.equal(resolveInput('KeyE'), 'interact');
  assert.equal(resolveInput('Space'), 'core_action');
  assert.equal(resolveInput('KeyZ'), null);
});

// ---------------------------------------------------------------- telemetry

test('the six required common events are declared', () => {
  assert.deepEqual(REQUIRED_EVENTS, [
    'session_started',
    'core_action_completed',
    'signature_reveal_seen',
    'choice_committed',
    'scenario_completed',
    'session_ended',
  ]);
});

test('a well-formed event validates', () => {
  const r = validateEvent({
    schema_version: 1,
    event: 'session_started',
    concept_id: 'return_to_sender',
    build_id: 'foundation-0.1.0',
    session_id: '11111111-1111-4111-8111-111111111111',
    sequence: 1,
    t_ms: 0,
    payload: {},
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('event missing concept_id is rejected by name', () => {
  const r = validateEvent({
    schema_version: 1,
    event: 'session_started',
    build_id: 'foundation-0.1.0',
    session_id: '11111111-1111-4111-8111-111111111111',
    sequence: 1,
    t_ms: 0,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('concept_id')), JSON.stringify(r.errors));
});

test('event missing build_id or session_id is rejected', () => {
  const base = {
    schema_version: 1,
    event: 'session_started',
    concept_id: 'return_to_sender',
    build_id: 'foundation-0.1.0',
    session_id: '11111111-1111-4111-8111-111111111111',
    sequence: 1,
    t_ms: 0,
  };
  const noBuild = { ...base };
  delete noBuild.build_id;
  const noSession = { ...base };
  delete noSession.session_id;
  assert.ok(validateEvent(noBuild).errors.some((e) => e.includes('build_id')));
  assert.ok(validateEvent(noSession).errors.some((e) => e.includes('session_id')));
});

test('unsupported event name is rejected', () => {
  const r = validateEvent({
    schema_version: 1,
    event: 'player_bought_lootbox',
    concept_id: 'return_to_sender',
    build_id: 'foundation-0.1.0',
    session_id: '11111111-1111-4111-8111-111111111111',
    sequence: 1,
    t_ms: 0,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /unsupported event/i.test(e)), JSON.stringify(r.errors));
});

test('unknown concept_id value is rejected even when the field exists', () => {
  const r = validateEvent({
    schema_version: 1,
    event: 'session_started',
    concept_id: 'some_other_game',
    build_id: 'foundation-0.1.0',
    session_id: '11111111-1111-4111-8111-111111111111',
    sequence: 1,
    t_ms: 0,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('concept_id')));
});

test('session validation requires all six events in causal order', () => {
  const good = runScenario({ conceptId: 'cursed_secondhand', seed: 7 });
  const r = validateSession(good.events);
  assert.equal(r.ok, true, JSON.stringify(r.errors));

  const missingReveal = good.events.filter((e) => e.event !== 'signature_reveal_seen');
  const r2 = validateSession(missingReveal);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('signature_reveal_seen')));
});

test('session validation rejects scenario_completed before the core action', () => {
  const s = runScenario({ conceptId: 'cursed_secondhand', seed: 7 });
  const scrambled = [...s.events];
  const ci = scrambled.findIndex((e) => e.event === 'scenario_completed');
  const ai = scrambled.findIndex((e) => e.event === 'core_action_completed');
  [scrambled[ci], scrambled[ai]] = [scrambled[ai], scrambled[ci]];
  const r = validateSession(scrambled);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('session validation rejects mixed concept ids in one session', () => {
  const s = runScenario({ conceptId: 'cursed_secondhand', seed: 7 });
  const mixed = s.events.map((e, i) => (i === 2 ? { ...e, concept_id: 'return_to_sender' } : e));
  const r = validateSession(mixed);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /concept_id/.test(e)));
});

// ---------------------------------------------------------------- profile

test('a fresh profile is created for a concept', () => {
  const root = tmpRoot();
  try {
    const p = createProfile({ root, conceptId: 'panic_at_the_pawnshop' });
    assert.equal(p.concept_id, 'panic_at_the_pawnshop');
    assert.equal(p.version, PROFILE_VERSION);
    assert.equal(p.sessions_started, 0);
    assert.ok(existsSync(p.path));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a corrupted profile is recovered as a clean profile with a recovery flag', () => {
  const root = tmpRoot();
  try {
    const p = createProfile({ root, conceptId: 'panic_at_the_pawnshop' });
    writeFileSync(p.path, '{ this is not json ]]]', 'utf8');
    const loaded = loadProfile({ root, conceptId: 'panic_at_the_pawnshop' });
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.recovery_reason, 'corrupt_profile');
    assert.equal(loaded.sessions_started, 0);
    assert.equal(loaded.version, PROFILE_VERSION);
    // The recovered profile must be persisted and re-loadable cleanly.
    const again = loadProfile({ root, conceptId: 'panic_at_the_pawnshop' });
    assert.equal(again.recovered, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a profile from an older schema version is reset rather than trusted', () => {
  const root = tmpRoot();
  try {
    const p = createProfile({ root, conceptId: 'return_to_sender' });
    writeFileSync(p.path, JSON.stringify({ version: 0, concept_id: 'return_to_sender', sessions_started: 42 }), 'utf8');
    const loaded = loadProfile({ root, conceptId: 'return_to_sender' });
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.recovery_reason, 'version_mismatch');
    assert.equal(loaded.sessions_started, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reset_profile clears progress but keeps the concept binding', () => {
  const root = tmpRoot();
  try {
    createProfile({ root, conceptId: 'theme_park_liquidation' });
    const before = loadProfile({ root, conceptId: 'theme_park_liquidation' });
    before.sessions_started = 3;
    writeFileSync(before.path, JSON.stringify(before), 'utf8');
    const after = resetProfile({ root, conceptId: 'theme_park_liquidation' });
    assert.equal(after.sessions_started, 0);
    assert.equal(after.concept_id, 'theme_park_liquidation');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- shell core

test('the shell rejects a launch with a missing concept_id', () => {
  assert.throws(() => runScenario({ seed: 1 }), /concept_id/i);
});

test('a scenario run emits all six required events for every concept', () => {
  for (const id of CONCEPT_IDS) {
    const s = runScenario({ conceptId: id, seed: 3 });
    const names = s.events.map((e) => e.event);
    for (const req of REQUIRED_EVENTS) {
      assert.ok(names.includes(req), `${id} missing ${req}`);
    }
    assert.equal(validateSession(s.events).ok, true, `${id} session invalid`);
  }
});

test('a scenario run performs the repeated core action at least three times', () => {
  const s = runScenario({ conceptId: 'fake_it_till_you_clean_it', seed: 5 });
  const core = s.events.filter((e) => e.event === 'core_action_completed');
  assert.ok(core.length >= 3, `expected >=3 core actions, got ${core.length}`);
});

test('scenario runs are deterministic for the same seed and differ across concepts', () => {
  const a = runScenario({ conceptId: 'return_to_sender', seed: 11 });
  const b = runScenario({ conceptId: 'return_to_sender', seed: 11 });
  assert.deepEqual(
    a.events.map((e) => [e.event, e.t_ms, e.sequence]),
    b.events.map((e) => [e.event, e.t_ms, e.sequence]),
  );
  const c = runScenario({ conceptId: 'cursed_secondhand', seed: 11 });
  assert.notEqual(a.events[0].concept_id, c.events[0].concept_id);
});

test('scenario active duration lands inside the 10-15 minute target window', () => {
  for (const id of CONCEPT_IDS) {
    const s = runScenario({ conceptId: id, seed: 2 });
    const mins = s.active_ms / 60000;
    assert.ok(mins >= 10 && mins <= 15, `${id} active minutes out of band: ${mins}`);
  }
});

test('the target window holds at both ends of the core-action range', () => {
  // The beat budget must be safe at the minimum (3) and maximum (5)
  // repetition counts, not merely for the reps a given seed happens to pick.
  for (const id of CONCEPT_IDS) {
    for (const reps of [3, 5]) {
      const s = runScenario({ conceptId: id, seed: 1, coreActions: reps });
      const mins = s.active_ms / 60000;
      assert.ok(mins >= 10 && mins <= 15, `${id} @${reps} reps out of band: ${mins}`);
    }
  }
});

test('many seeds never fall outside the target window', () => {
  for (const id of CONCEPT_IDS) {
    for (let seed = 1; seed <= 50; seed += 1) {
      const s = runScenario({ conceptId: id, seed });
      const mins = s.active_ms / 60000;
      assert.ok(mins >= 10 && mins <= 15, `${id} seed ${seed} out of band: ${mins}`);
      const core = s.events.filter((e) => e.event === 'core_action_completed').length;
      assert.ok(core >= 3, `${id} seed ${seed} only ${core} core actions`);
    }
  }
});

// ---------------------------------------------------------------- scorecard

test('a scorecard export validates with in-range 1-5 ratings', () => {
  const s = runScenario({ conceptId: 'return_to_sender', seed: 9 });
  const card = buildScorecard({
    session: s,
    ratings: {
      role_clarity: 4,
      first_payoff_timing: 3,
      repeated_action_satisfaction: 5,
      signature_reveal_memorability: 4,
      meaningful_choice: 3,
      next_scenario_desire: 5,
      five_to_ten_hour_potential: 4,
    },
    notes: 'baseline shell',
  });
  const r = validateScorecard(card);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(card.concept_id, 'return_to_sender');
  assert.ok(card.build_id);
});

test('a scorecard with an out-of-range rating is rejected', () => {
  const s = runScenario({ conceptId: 'return_to_sender', seed: 9 });
  const card = buildScorecard({
    session: s,
    ratings: {
      role_clarity: 6,
      first_payoff_timing: 3,
      repeated_action_satisfaction: 5,
      signature_reveal_memorability: 4,
      meaningful_choice: 3,
      next_scenario_desire: 5,
      five_to_ten_hour_potential: 4,
    },
  });
  const r = validateScorecard(card);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('role_clarity')));
});

test('a scorecard missing a required rating dimension is rejected', () => {
  const s = runScenario({ conceptId: 'return_to_sender', seed: 9 });
  const card = buildScorecard({ session: s, ratings: { role_clarity: 4 } });
  const r = validateScorecard(card);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('next_scenario_desire')));
});

// ---------------------------------------------------------------- decision log

test('a decision record carries build, limitations, decision and rationale', () => {
  const s = runScenario({ conceptId: 'theme_park_liquidation', seed: 4 });
  const rec = buildDecisionRecord({
    session: s,
    decision: 'hold',
    rationale: 'foundation shell only; no candidate content yet',
    known_limitations: ['blank shell', 'no candidate art'],
  });
  assert.equal(rec.concept_id, 'theme_park_liquidation');
  assert.equal(rec.decision, 'hold');
  assert.ok(rec.build_id);
  assert.ok(Array.isArray(rec.known_limitations));
  assert.ok(rec.rationale.length > 0);
});

test('an unsupported decision verdict is rejected', () => {
  const s = runScenario({ conceptId: 'theme_park_liquidation', seed: 4 });
  assert.throws(
    () => buildDecisionRecord({ session: s, decision: 'ship_to_steam', rationale: 'x' }),
    /decision/i,
  );
});
