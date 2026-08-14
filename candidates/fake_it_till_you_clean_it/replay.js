#!/usr/bin/env node
/**
 * Deterministic replay / validation driver for FAKE IT TILL YOU CLEAN IT.
 *
 * Headless proof, independent of the browser: it walks the descriptor's own
 * replay ordering through the SHARED gate (blockedSteps) and the SHARED
 * telemetry validator, so this candidate cannot pass by inventing its own
 * rules. Two runs of the same seed produce byte-identical event streams.
 *
 * It also exercises both declared invalid paths and asserts each yields a
 * NAMED blocked requirement and no scenario_completed event.
 *
 * Usage:
 *   node candidates/fake_it_till_you_clean_it/replay.js [--seed N] [--json]
 *
 * Exit: 0 pass, 1 fail.
 */

import { blockedSteps, STEP_KINDS, validateDescriptor } from '../../core/candidate.js';
import { validateSession, SCHEMA_VERSION } from '../../core/telemetry.js';
import { buildIdentity } from '../../core/build-identity.js';
import { getConcept } from '../../core/concepts.js';
import { evaluateSuccessCondition } from '../../core/shell-core.js';
import descriptor from './scenario.js';

const CONCEPT_ID = 'fake_it_till_you_clean_it';

/** Same beat budget the foundation uses, so active time lands in 10-15 min. */
const WRAP_MS = 70_000;

function parseArgs(argv) {
  const args = { seed: 1, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--seed') args.seed = Number(argv[++i]);
    else if (argv[i] === '--json') args.json = true;
    else {
      process.stderr.write(`unknown argument: ${argv[i]}\n`);
      process.exit(2);
    }
  }
  return args;
}

/** Deterministic UUID-shaped session id derived from concept + seed. */
function sessionIdFor(conceptId, seed) {
  let h = 2166136261 >>> 0;
  for (const ch of `${conceptId}:${seed}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h >>> 0;
  const hex = [];
  for (let i = 0; i < 32; i += 1) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    hex.push((((t ^ (t >>> 14)) >>> 0) % 16).toString(16));
  }
  const s = hex.join('');
  return [s.slice(0, 8), s.slice(8, 12), `4${s.slice(13, 16)}`, `8${s.slice(17, 20)}`, s.slice(20, 32)].join('-');
}

/**
 * Replay the descriptor deterministically.
 * @param {{seed?: number, order?: string[], stopBefore?: string}} opts
 */
export function replay({ seed = 1, order = descriptor.replay, stopBefore = null } = {}) {
  const concept = getConcept(CONCEPT_ID);
  const identity = buildIdentity(CONCEPT_ID);
  const sessionId = sessionIdFor(CONCEPT_ID, seed);

  const events = [];
  const completed = [];
  const blockedReport = [];
  const transformations = [];
  let sequence = 0;
  let t = 0;

  const emit = (event, payload = {}) => {
    sequence += 1;
    events.push({
      schema_version: SCHEMA_VERSION,
      event,
      concept_id: CONCEPT_ID,
      build_id: identity.build_id,
      session_id: sessionId,
      sequence,
      t_ms: t,
      payload,
    });
  };

  emit('session_started', {
    role: concept.role,
    target_minutes: concept.target_minutes,
    profile: 'fresh',
  });

  for (const stepId of order) {
    if (stopBefore && stepId === stopBefore) break;
    const step = descriptor.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`replay references unknown step "${stepId}"`);

    // Shared gate: never a candidate-local reimplementation.
    const blocked = blockedSteps(descriptor, completed).find((b) => b.id === stepId);
    if (blocked) {
      emit('invalid_action_blocked', {
        attempted: stepId,
        reason: 'prerequisites_not_met',
        missing: blocked.missing,
      });
      blockedReport.push({ attempted: stepId, missing: blocked.missing });
      continue;
    }

    t += step.duration_ms ?? 0;
    const payload = { step_id: step.id, label: step.label };
    if (step.kind === 'core_action') {
      payload.repetition = completed.filter(
        (id) => descriptor.steps.find((s) => s.id === id)?.kind === 'core_action',
      ).length + 1;
      payload.action = concept.core_action;
      payload.transformation_visible = Boolean(step.transformation);
    } else if (step.kind === 'reveal') {
      payload.reveal = concept.signature_reveal;
      payload.clue = step.staged_success_clue.id;
    } else if (step.kind === 'choice') {
      payload.prompt = concept.choice;
      payload.option = step.default_option;
      payload.evidence_object = step.evidence_object;
      payload.reversible = false;
    } else {
      payload.subject = step.id;
    }

    emit(STEP_KINDS[step.kind], payload);
    completed.push(step.id);
    if (step.transformation) {
      transformations.push({ step: step.id, ...step.transformation });
    }
  }

  const outstanding = descriptor.steps.filter((s) => !completed.includes(s.id));
  if (outstanding.length === 0) {
    t += WRAP_MS;
    emit('scenario_completed', {
      core_actions: completed.filter(
        (id) => descriptor.steps.find((s) => s.id === id).kind === 'core_action',
      ).length,
      unassisted: true,
      active_ms: t,
    });
    emit('next_hook_shown', { hook: descriptor.next_hook.label });
    emit('session_ended', { reason: 'scenario_completed', active_ms: t });
  } else {
    // Honest failure: an incomplete run must NOT claim completion.
    emit('session_ended', { reason: 'incomplete_requirements_outstanding', active_ms: t });
  }

  return {
    concept_id: CONCEPT_ID,
    build_id: identity.build_id,
    build_hash: identity.build_hash,
    core_hash: identity.core_hash,
    session_id: sessionId,
    seed,
    events,
    active_ms: t,
    completed_steps: completed,
    outstanding_steps: outstanding.map((s) => s.id),
    blocked: blockedReport,
    transformations,
  };
}

/** Run one declared invalid path and report whether it was named-blocked. */
function runInvalidPath(path) {
  // Attempt the gated step immediately after its declared partial progress.
  const order = [...path.completed, path.attempt];
  const run = replay({ seed: 99, order });
  const names = run.events.map((e) => e.event);
  const blocked = run.blocked.find((b) => b.attempted === path.attempt);
  return {
    id: path.id,
    requirement: path.requirement,
    attempted: path.attempt,
    blocked_named: Boolean(blocked),
    missing: blocked?.missing ?? [],
    expected_missing: path.expect_missing,
    missing_matches: JSON.stringify(blocked?.missing ?? []) === JSON.stringify(path.expect_missing),
    completed_emitted: names.includes('scenario_completed'),
    outstanding: run.outstanding_steps,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const failures = [];
  const out = (s) => { if (!args.json) process.stdout.write(s); };

  // --- descriptor validity -------------------------------------------------
  const check = validateDescriptor(descriptor, CONCEPT_ID);
  if (!check.ok) failures.push(`descriptor invalid: ${check.errors.join('; ')}`);
  out(`descriptor validation : ${check.ok ? 'VALID' : 'INVALID'}\n`);

  // --- happy path ----------------------------------------------------------
  const a = replay({ seed: args.seed });
  const b = replay({ seed: args.seed });
  const deterministic = JSON.stringify(a.events) === JSON.stringify(b.events);
  if (!deterministic) failures.push('replay is not deterministic for one seed');

  const validation = validateSession(a.events);
  if (!validation.ok) failures.push(`telemetry invalid: ${validation.errors.join('; ')}`);

  const success = evaluateSuccessCondition(a);
  if (!success.ok) {
    failures.push(`shared success condition failed: ${JSON.stringify(success.checks)}`);
  }

  out(`deterministic replay  : ${deterministic ? 'IDENTICAL across 2 runs' : 'DIVERGED'}\n`);
  out(`telemetry validation  : ${validation.ok ? 'VALID' : 'INVALID: ' + validation.errors.join('; ')}\n`);
  out(`active play minutes   : ${success.active_minutes} (target 10-15)\n`);
  out(`shared success        : ${success.ok ? 'ALL CHECKS PASS' : 'FAIL'}\n`);
  for (const [k, v] of Object.entries(success.checks)) out(`   ${v ? 'ok  ' : 'FAIL'} ${k}\n`);

  out('\nvisible transformation chain:\n');
  for (const tr of a.transformations) out(`   ${tr.step.padEnd(24)} ${tr.before}\n${' '.repeat(27)}-> ${tr.after}\n`);

  // --- invalid paths -------------------------------------------------------
  out('\ninvalid-path probes:\n');
  const invalid = descriptor.invalid_paths.map(runInvalidPath);
  for (const r of invalid) {
    const ok = r.blocked_named && r.missing_matches && !r.completed_emitted;
    if (!ok) failures.push(`invalid path ${r.id} did not produce a named block without completion`);
    out(`   ${ok ? 'ok  ' : 'FAIL'} ${r.id}\n`);
    out(`        requirement : ${r.requirement}\n`);
    out(`        blocked     : ${r.attempted} missing [${r.missing.join(', ')}]\n`);
    out(`        completed   : ${r.completed_emitted ? 'EMITTED (BUG)' : 'not emitted (correct)'}\n`);
  }

  // --- invalid-then-valid recovery ----------------------------------------
  const recovery = replay({
    seed: args.seed,
    order: [descriptor.invalid_paths[0].attempt, ...descriptor.replay],
  });
  const recoveryValid = validateSession(recovery.events);
  const recovered = recovery.outstanding_steps.length === 0
    && recovery.blocked.length > 0
    && recoveryValid.ok;
  if (!recovered) failures.push('invalid-first replay did not recover to a valid completed session');
  out(`\ninvalid-first recovery: ${recovered ? 'RECOVERED and completed' : 'FAILED'}\n`);
  out(`   blocked attempts   : ${recovery.blocked.map((b) => b.attempted).join(', ') || 'none'}\n`);

  const result = {
    concept_id: CONCEPT_ID,
    build_id: a.build_id,
    build_hash: a.build_hash,
    core_hash: a.core_hash,
    seed: args.seed,
    descriptor_valid: check.ok,
    deterministic,
    telemetry_valid: validation.ok,
    success_condition: success,
    active_ms: a.active_ms,
    session: a,
    invalid_paths: invalid,
    invalid_first_recovery: {
      recovered,
      blocked: recovery.blocked,
      events: recovery.events.length,
      telemetry_valid: recoveryValid.ok,
    },
    failures,
    ok: failures.length === 0,
  };

  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    out(`\nRESULT: ${result.ok ? 'PASS' : 'FAIL'}\n`);
    for (const f of failures) out(`   FAIL ${f}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
