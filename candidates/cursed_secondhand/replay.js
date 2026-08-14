#!/usr/bin/env node
/**
 * CURSED SECONDHAND deterministic replay and export driver.
 *
 * Walks the candidate descriptor through the shared prerequisite gate and
 * emits the shared telemetry schema. No wall clock or random source is used,
 * so an equal seed and script produce byte-identical output.
 *
 * Usage:
 *   node candidates/cursed_secondhand/replay.js
 *     [--seed N] [--invalid-first] [--json] [--out DIR]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { blockedSteps, STEP_KINDS, validateDescriptor } from '../../core/candidate.js';
import { buildIdentity } from '../../core/build-identity.js';
import { getConcept } from '../../core/concepts.js';
import { evaluateSuccessCondition } from '../../core/shell-core.js';
import { SCHEMA_VERSION, validateSession } from '../../core/telemetry.js';
import descriptor from './scenario.js';

const CONCEPT_ID = 'cursed_secondhand';
const WRAP_MS = 40_000;

function sessionIdFor(seed, invalidFirst) {
  let h = 2166136261 >>> 0;
  for (const ch of `${CONCEPT_ID}:${seed}:${invalidFirst ? 'invalid-first' : 'valid'}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hex = [];
  let a = h;
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

function stepById(id) {
  const step = descriptor.steps.find((candidateStep) => candidateStep.id === id);
  if (!step) throw new Error(`unknown scenario step "${id}"`);
  return step;
}

/**
 * Run one deterministic workshop session.
 *
 * Invalid-first deliberately attempts the reveal before diagnosis/tools and
 * the disposition before the reveal, then continues in the SAME session.
 */
export function runReplay({ seed = 1, invalidFirst = false } = {}) {
  if (!Number.isFinite(seed)) throw new Error('seed must be a finite number');

  const concept = getConcept(CONCEPT_ID);
  const identity = buildIdentity(CONCEPT_ID);
  const sessionId = sessionIdFor(seed, invalidFirst);
  const events = [];
  const completed = [];
  const blocked = [];
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
    intake_id: descriptor.item.intake_id,
  });

  const attempt = (stepId) => {
    const step = stepById(stepId);
    if (completed.includes(stepId)) return false;

    const gate = blockedSteps(descriptor, completed).find((entry) => entry.id === stepId);
    if (gate) {
      const report = {
        attempted: stepId,
        reason: 'prerequisites_not_met',
        missing: gate.missing,
        recovery: `complete ${gate.missing.join(', ')} then retry ${stepId}`,
      };
      emit('invalid_action_blocked', report);
      blocked.push(report);
      return false;
    }

    t += step.duration_ms ?? 0;
    const payload = {
      step_id: step.id,
      label: step.label,
      transformation: step.transformation,
    };

    if (step.kind === 'inspect') {
      payload.subject = step.id;
      if (step.id === 'diagnose') {
        payload.traces = descriptor.traces.map((trace) => trace.kind);
        payload.tools_unlocked = [...step.unlocks_tools];
      } else {
        payload.clue = step.clue;
        payload.personal_memory = true;
      }
    } else if (step.kind === 'core_action') {
      payload.repetition = completed.filter((id) => stepById(id).kind === 'core_action').length + 1;
      payload.action = concept.core_action;
      payload.tool = step.tool;
      payload.restores = step.restores;
      payload.transformation_visible = true;
    } else if (step.kind === 'reveal') {
      payload.reveal = concept.signature_reveal;
      payload.interior_space = true;
      payload.reversible = step.reversible;
      payload.reverts_to = step.reverts_to;
    } else if (step.kind === 'choice') {
      payload.prompt = concept.choice;
      payload.option = step.default_option;
      payload.available_options = step.options.map((option) => option.id);
      payload.reversible = false;
    }

    emit(STEP_KINDS[step.kind], payload);
    completed.push(stepId);
    transformations.push({ step: step.id, ...step.transformation });
    return true;
  };

  let prematureCompletionBlocked = false;
  if (invalidFirst) {
    attempt('interior_reveal');
    attempt('disposition');
    attempt('dust_pass');
    prematureCompletionBlocked = completed.length !== descriptor.steps.length;
    if (prematureCompletionBlocked) {
      const outstanding = descriptor.steps.filter((step) => !completed.includes(step.id)).map((step) => step.id);
      emit('invalid_action_blocked', {
        attempted: 'scenario_completed',
        reason: 'beats_incomplete',
        missing: outstanding,
        recovery: `complete ${outstanding[0]} and the remaining ordered steps`,
      });
    }
  }

  for (const stepId of descriptor.replay) attempt(stepId);

  const outstanding = descriptor.steps.filter((step) => !completed.includes(step.id)).map((step) => step.id);
  if (outstanding.length === 0) {
    t += WRAP_MS;
    emit('scenario_completed', {
      core_actions: completed.filter((id) => stepById(id).kind === 'core_action').length,
      unassisted: true,
      active_ms: t,
      disposition: stepById('disposition').default_option,
    });
    emit('next_hook_shown', {
      hook: descriptor.next_hook.text,
      intake_id: descriptor.next_hook.id,
    });
    emit('session_ended', { reason: 'scenario_completed', active_ms: t });
  } else {
    emit('session_ended', {
      reason: 'incomplete_requirements_outstanding',
      active_ms: t,
      missing: outstanding,
    });
  }

  const validation = validateSession(events);
  const success = evaluateSuccessCondition({ events, active_ms: t });
  const names = events.map((event) => event.event);
  const firstCompletion = names.indexOf('scenario_completed');
  const lastBlock = names.lastIndexOf('invalid_action_blocked');
  const failures = [];

  if (!validation.ok) failures.push(...validation.errors.map((error) => `telemetry: ${error}`));
  if (!success.ok) failures.push(`shared success condition: ${JSON.stringify(success.checks)}`);
  if (completed.length !== descriptor.steps.length) failures.push(`outstanding steps: ${outstanding.join(', ')}`);
  if (transformations.length !== descriptor.steps.length) failures.push('not every step recorded its visible transformation');
  if (invalidFirst) {
    const expected = new Map([
      ['interior_reveal', ['memory_clue']],
      ['disposition', ['interior_reveal']],
      ['dust_pass', ['diagnose']],
    ]);
    for (const [attempted, missing] of expected) {
      const report = blocked.find((entry) => entry.attempted === attempted);
      if (!report || JSON.stringify(report.missing) !== JSON.stringify(missing)) {
        failures.push(`${attempted} did not name missing [${missing.join(', ')}]`);
      }
    }
    if (!prematureCompletionBlocked || firstCompletion === -1 || firstCompletion < lastBlock) {
      failures.push('invalid-first path completed before recovery finished');
    }
  }

  return {
    concept: 'CURSED SECONDHAND',
    concept_id: CONCEPT_ID,
    build_id: identity.build_id,
    build_hash: identity.build_hash,
    core_hash: identity.core_hash,
    session_id: sessionId,
    seed,
    invalid_first: invalidFirst,
    events,
    completed_steps: completed,
    blocked,
    transformations,
    active_ms: t,
    active_minutes: Number((t / 60000).toFixed(2)),
    validation,
    success_condition: success,
    failures,
    ok: failures.length === 0,
  };
}

function parseArgs(argv) {
  const args = { seed: 1, invalidFirst: false, json: false, out: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--invalid-first') args.invalidFirst = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--out') args.out = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.seed)) throw new Error('--seed must be a finite number');
  if (args.out !== null && !args.out) throw new Error('--out requires a directory');
  return args;
}

function render(run) {
  const lines = [
    'CURSED SECONDHAND deterministic replay',
    `build_id             : ${run.build_id}`,
    `mode                 : ${run.invalid_first ? 'invalid-first recovery' : 'valid'}`,
    `active play          : ${run.active_minutes.toFixed(2)} minutes`,
    `telemetry            : ${run.validation.ok ? 'VALID' : 'INVALID'}`,
    `shared success       : ${run.success_condition.ok ? 'PASS' : 'FAIL'}`,
    `restoration passes   : ${run.events.filter((event) => event.event === 'core_action_completed').length}`,
    `blocked attempts     : ${run.events.filter((event) => event.event === 'invalid_action_blocked').length}`,
    `result               : ${run.ok ? 'PASS' : 'FAIL'}`,
  ];
  for (const report of run.blocked) {
    lines.push(`  blocked ${report.attempted}: missing ${report.missing.join(', ')}`);
  }
  for (const failure of run.failures) lines.push(`  FAIL ${failure}`);
  return lines.join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  const run = runReplay(args);
  if (args.out) {
    const dir = resolve(args.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${CONCEPT_ID}.session.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(args.json ? `${JSON.stringify(run, null, 2)}\n` : `${render(run)}\n`);
  process.exit(run.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
