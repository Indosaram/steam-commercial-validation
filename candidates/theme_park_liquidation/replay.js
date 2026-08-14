#!/usr/bin/env node
/** Deterministic Task 4 replay through the shared prerequisite contract. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildIdentity } from '../../core/build-identity.js';
import { getConcept } from '../../core/concepts.js';
import { blockedSteps, STEP_KINDS } from '../../core/scenario-contract.js';
import { SCHEMA_VERSION } from '../../core/telemetry.js';
import descriptor from './scenario.js';

export const CONCEPT_ID = 'theme_park_liquidation';
export const MODES = Object.freeze(['valid', 'blocked_path', 'missing_controls']);

function sessionId(label) {
  let h = 2166136261 >>> 0;
  for (const c of `${CONCEPT_ID}:${label}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let s = '';
  for (let i = 0; i < 32; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0;
    s += ((h >>> 28) & 15).toString(16);
  }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20)}`;
}

const byId = (id) => descriptor.steps.find((step) => step.id === id);

export function runReplay({ mode = 'valid', choice = 'display', seed = 424242 } = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  const option = byId('batch_disposition').options.find((entry) => entry.id === choice);
  if (!option) throw new Error(`unknown disposition ${choice}`);

  const concept = getConcept(CONCEPT_ID);
  const identity = buildIdentity(CONCEPT_ID);
  const events = [];
  const completed = [];
  const transformations = [];
  let sequence = 0;
  let t = 0;
  let coreActions = 0;

  const emit = (event, payload = {}) => events.push({
    schema_version: SCHEMA_VERSION,
    event,
    concept_id: CONCEPT_ID,
    build_id: identity.build_id,
    session_id: sessionId(`${seed}:${mode}:${choice}`),
    sequence: ++sequence,
    t_ms: t,
    payload,
  });

  emit('session_started', {
    role: concept.role,
    target_minutes: concept.target_minutes,
    profile: 'fresh',
    mode,
  });

  const attempt = (id) => {
    const step = byId(id);
    const blocked = blockedSteps(descriptor, completed).find((entry) => entry.id === id);
    if (blocked) {
      emit('invalid_action_blocked', {
        attempted: id,
        reason: 'prerequisites_not_met',
        missing: blocked.missing,
        explanation: step.blocked_message ?? `Blocked ${id}: missing ${blocked.missing.join(', ')}.`,
      });
      return false;
    }

    t += step.duration_ms ?? 0;
    const payload = { step_id: id, label: step.label, space: step.space, beat: step.beat };
    if (step.kind === 'core_action') {
      payload.repetition = ++coreActions;
      payload.action = concept.core_action;
      payload.transformation_visible = true;
    } else if (step.kind === 'reveal') {
      payload.reveal = concept.signature_reveal;
      payload.finding = step.detail;
    } else if (step.kind === 'choice') {
      payload.prompt = step.prompt;
      payload.option = option.id;
      payload.outcome = option.outcome;
      payload.reversible = false;
    } else payload.subject = id;
    payload.transformation = step.transformation;
    emit(STEP_KINDS[step.kind], payload);
    transformations.push({ step_id: id, ...step.transformation });
    completed.push(id);
    return true;
  };

  if (mode === 'blocked_path') {
    for (const id of descriptor.replay) {
      if (!['clear_debris', 'run_show', 'next_attraction_hook'].includes(id)) completed.push(id);
    }
    attempt('run_show');
  } else if (mode === 'missing_controls') {
    for (const id of descriptor.replay) {
      if (!['reseat_fuse', 'run_show', 'next_attraction_hook'].includes(id)) completed.push(id);
    }
    attempt('run_show');
  } else {
    for (const id of descriptor.replay) attempt(id);
    t += descriptor.intro_ms + descriptor.wrap_ms;
    emit('scenario_completed', { core_actions: coreActions, unassisted: true, active_ms: t });
    emit('next_hook_shown', { hook: concept.next_hook, step_id: 'next_attraction_hook' });
    emit('session_ended', { reason: 'scenario_completed', active_ms: t });
  }

  const blocked = events.filter((event) => event.event === 'invalid_action_blocked');
  const completedScenario = events.some((event) => event.event === 'scenario_completed');
  const failures = [];
  if (mode === 'valid') {
    for (const required of ['session_started', 'core_action_completed', 'signature_reveal_seen', 'choice_committed', 'scenario_completed', 'session_ended']) {
      if (!events.some((event) => event.event === required)) failures.push(`missing ${required}`);
    }
    if (completed.length !== descriptor.steps.length) failures.push(`completed ${completed.length}/${descriptor.steps.length} steps`);
    if (t < 600000 || t > 900000) failures.push(`active_ms ${t} outside 10-15 minutes`);
  } else {
    const expected = mode === 'blocked_path' ? 'clear_debris' : 'reseat_fuse';
    if (blocked.length !== 1 || !blocked[0].payload.missing.includes(expected)) failures.push(`blocked attempt did not name ${expected}`);
    if (completedScenario) failures.push('blocked replay emitted scenario_completed');
  }

  return {
    concept_id: CONCEPT_ID,
    build_id: identity.build_id,
    build_hash: identity.build_hash,
    seed,
    mode,
    choice,
    events,
    completed,
    transformations,
    active_ms: t,
    active_minutes: Number((t / 60000).toFixed(2)),
    completed_scenario: completedScenario,
    blocked_as_expected: mode === 'valid' ? null : failures.length === 0,
    ok: failures.length === 0,
    failures,
  };
}

function parseArgs(argv) {
  const args = { mode: 'valid', choice: 'display', seed: 424242, out: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--mode') args.mode = argv[++i];
    else if (argv[i] === '--choice') args.choice = argv[++i];
    else if (argv[i] === '--seed') args.seed = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function render(run) {
  const names = run.events.map((event) => event.event);
  const blocked = run.events.find((event) => event.event === 'invalid_action_blocked');
  return [
    `THEME PARK LIQUIDATION replay`,
    `mode: ${run.mode}`,
    `build_id: ${run.build_id}`,
    `active_minutes: ${run.active_minutes}`,
    `completed_steps: ${run.completed.length}/${descriptor.steps.length}`,
    `events: ${names.join(' -> ')}`,
    blocked ? `blocked: ${blocked.payload.attempted}; missing=${blocked.payload.missing.join(',')}` : 'blocked: none',
    `scenario_completed: ${run.completed_scenario}`,
    `result: ${run.ok ? 'PASS' : 'FAIL'}`,
  ].join('\n');
}

async function main() {
  let args;
  try { args = parseArgs(process.argv); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
  if (!MODES.includes(args.mode) || !Number.isFinite(args.seed)) {
    process.stderr.write(`invalid mode or seed; modes=${MODES.join(',')}\n`);
    process.exit(2);
  }
  let run;
  try { run = runReplay(args); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
  process.stdout.write(`${render(run)}\n`);
  if (args.out) {
    const out = resolve(args.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${CONCEPT_ID}.${args.mode}.session.json`), `${JSON.stringify(run, null, 2)}\n`);
  }
  if (!run.ok) {
    for (const failure of run.failures) process.stderr.write(`! ${failure}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
