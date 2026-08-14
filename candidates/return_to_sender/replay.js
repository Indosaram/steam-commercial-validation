/**
 * RETURN TO SENDER - deterministic replay driver (Task 3, Wave 2).
 *
 * Owned by this candidate. It drives the on-disk descriptor through the SAME
 * shared rules the browser shell uses:
 *
 *   - step selection: the first still-incomplete step of the pressed verb kind
 *     (shell/shell.js runCandidateStep)
 *   - gating: core/scenario-contract.js blockedSteps()
 *   - event names: core/candidate.js STEP_KINDS
 *   - telemetry shape: core/telemetry.js (validated, never re-implemented)
 *
 * It re-implements no validation and owns no schema. Its only job is to press
 * the same keys a player presses, in a fixed order, so a run is reproducible
 * and comparable with the other four candidates.
 *
 * Nothing here is random. There is no seeded loot, no value roll, no currency.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { getConcept } from '../../core/concepts.js';
import { SCHEMA_VERSION, validateSession } from '../../core/telemetry.js';
import { buildIdentity } from '../../core/build-identity.js';
import { evaluateSuccessCondition } from '../../core/shell-core.js';
import { blockedSteps, STEP_KINDS, validateDescriptor } from '../../core/scenario-contract.js';
import descriptor from './scenario.js';

export const CONCEPT_ID = 'return_to_sender';

/** The three parcel handling categories this scenario must resolve. */
export const PARCEL_CATEGORIES = Object.freeze(['normal', 'fragile', 'return']);

/** Verb -> step kind, matching the shared input map used by the browser shell. */
const VERB_KIND = Object.freeze({
  interact: 'inspect',
  core_action: 'core_action',
  inspect: 'reveal', // Q triggers the reveal in the shared shell
  commit_choice: 'choice',
});

/**
 * Stable, UUID-shaped session id derived from the concept and a run label, so
 * replays are reproducible without Math.random and still satisfy the shared
 * session_id format check.
 */
function deterministicSessionId(label) {
  let h = 2166136261 >>> 0;
  const seedStr = `${CONCEPT_ID}:${label}`;
  const hex = [];
  for (let i = 0; i < 32; i += 1) {
    h ^= seedStr.charCodeAt(i % seedStr.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    hex.push(((h >>> 24) & 0x0f).toString(16));
  }
  const s = hex.join('');
  return [
    s.slice(0, 8),
    s.slice(8, 12),
    `4${s.slice(13, 16)}`,
    `8${s.slice(17, 20)}`,
    s.slice(20, 32),
  ].join('-');
}

/**
 * Run a scripted play-through of the descriptor.
 *
 * @param {object} descriptor  the loaded candidate descriptor
 * @param {{label?: string, script?: Array<{verb?: string, step_id?: string}|string>}} [options]
 *        `script` defaults to the descriptor's replay translated into shared
 *        verb presses. A `step_id` entry is available for descriptor-level
 *        adversarial probes that must target a later same-kind step directly;
 *        it still passes through the shared prerequisite gate.
 * @returns {{events: object[], completed: string[], blocked: object[],
 *            active_ms: number, lane_state: string, transformations: object[],
 *            completed_scenario: boolean}}
 */
export function runReplay(descriptor, { label = 'default', script = null } = {}) {
  const concept = getConcept(CONCEPT_ID);
  const identity = buildIdentity(CONCEPT_ID);
  const sessionId = deterministicSessionId(label);

  const events = [];
  const completed = [];
  const blocked = [];
  const transformations = [];
  let sequence = 0;
  let t = 0;
  let coreActions = 0;
  let laneState = descriptor.steps[0]?.transformation?.before ?? 'lane_blocked_full';
  let completedScenario = false;

  const emit = (name, payload = {}) => {
    sequence += 1;
    events.push({
      schema_version: SCHEMA_VERSION,
      event: name,
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

  const verbs = script ?? descriptor.replay.map((stepId) => {
    const step = descriptor.steps.find((s) => s.id === stepId);
    return Object.entries(VERB_KIND).find(([, kind]) => kind === step.kind)[0];
  });

  for (const entry of verbs) {
    const verb = typeof entry === 'string' ? entry : entry.verb;
    const targetedStepId = typeof entry === 'object' ? entry.step_id : null;

    // The exit attempt: the shared shell refuses completion while any step
    // is still incomplete, and emits a named block instead.
    if (verb === 'advance') {
      const pending = descriptor.steps.filter((s) => !completed.includes(s.id));
      if (pending.length > 0) {
        const record = {
          attempted: 'scenario_completed',
          reason: 'beats_incomplete',
          missing: pending.map((s) => s.id),
        };
        blocked.push(record);
        emit('invalid_action_blocked', record);
        continue;
      }
      t += 1_000;
      completedScenario = true;
      emit('scenario_completed', { core_actions: coreActions, unassisted: true, active_ms: t });
      emit('next_hook_shown', { hook: descriptor.next_hook?.text ?? concept.next_hook });
      emit('session_ended', { reason: 'scenario_completed', active_ms: t });
      continue;
    }

    const targetedStep = targetedStepId
      ? descriptor.steps.find((s) => s.id === targetedStepId && !completed.includes(s.id))
      : null;
    if (targetedStepId && !targetedStep) throw new Error(`replay: unknown or completed step "${targetedStepId}"`);

    const kind = targetedStep?.kind ?? VERB_KIND[verb];
    if (!kind) throw new Error(`replay: unsupported verb "${verb}"`);

    // Normal entries use the shared shell's first-pending-kind rule. Explicit
    // step ids exist only for exact descriptor-level adversarial probes.
    const step = targetedStep
      ?? descriptor.steps.find((s) => s.kind === kind && !completed.includes(s.id));
    if (!step) {
      const record = { attempted: kind, reason: 'no_pending_step_of_kind' };
      blocked.push(record);
      emit('invalid_action_blocked', record);
      continue;
    }

    const gate = blockedSteps(descriptor, completed).find((b) => b.id === step.id);
    if (gate) {
      const penalty = step.invalid_if_missing
        ? gate.missing.map((m) => step.invalid_if_missing[m]).filter(Boolean)
        : [];
      const record = {
        attempted: step.id,
        reason: 'prerequisites_not_met',
        missing: gate.missing,
        penalty: penalty.length ? penalty : undefined,
        recoverable: true,
      };
      blocked.push(record);
      emit('invalid_action_blocked', record);
      continue;
    }

    t += step.duration_ms ?? 0;
    const payload = { step_id: step.id, label: step.label ?? step.id };
    if (step.kind === 'core_action') {
      coreActions += 1;
      payload.repetition = coreActions;
      payload.action = concept.core_action;
      payload.transformation_visible = Boolean(step.transformation);
      if (step.parcel_category) payload.parcel_category = step.parcel_category;
    } else if (step.kind === 'reveal') {
      payload.reveal = concept.signature_reveal;
      if (step.clue) payload.clue = step.clue;
    } else if (step.kind === 'choice') {
      payload.prompt = step.decision?.prompt ?? concept.choice;
      payload.option = step.decision?.committed ?? 'option_a';
      payload.reversible = false;
    } else {
      payload.subject = step.id;
      if (step.decision) {
        payload.decision = step.decision.committed;
        payload.prompt = step.decision.prompt;
      }
    }

    emit(STEP_KINDS[step.kind], payload);
    completed.push(step.id);

    if (step.transformation) {
      transformations.push({ step: step.id, ...step.transformation });
      laneState = step.transformation.after;
    }
  }

  return {
    concept_id: CONCEPT_ID,
    build_id: identity.build_id,
    build_hash: identity.build_hash,
    core_hash: identity.core_hash,
    session_id: sessionId,
    events,
    completed,
    blocked,
    transformations,
    active_ms: t,
    lane_state: laneState,
    core_actions: coreActions,
    completed_scenario: completedScenario,
  };
}

/** The full valid play-through: every step in descriptor order, then exit. */
export function validScript(descriptor) {
  return [
    ...descriptor.replay.map((stepId) => {
      const step = descriptor.steps.find((s) => s.id === stepId);
      return Object.entries(VERB_KIND).find(([, kind]) => kind === step.kind)[0];
    }),
    'advance',
  ];
}

function parseArgs(argv) {
  const args = { out: null, label: 'task-3' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--label') args.label = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  const descriptorCheck = validateDescriptor(descriptor, CONCEPT_ID);
  const valid = runReplay(descriptor, { label: args.label, script: validScript(descriptor) });
  const duplicate = runReplay(descriptor, { label: args.label, script: validScript(descriptor) });
  const telemetry = validateSession(valid.events);
  const success = evaluateSuccessCondition(valid);
  const deterministic = JSON.stringify(valid) === JSON.stringify(duplicate);

  const fragilePriorityBlock = runReplay(descriptor, {
    label: `${args.label}-invalid-compactor`,
    script: ['interact', { step_id: 'route_compactor' }],
  });
  const earlyExitBlock = runReplay(descriptor, {
    label: `${args.label}-invalid-exit`,
    script: ['interact', 'core_action', 'core_action', 'core_action', 'advance'],
  });
  const recovered = runReplay(descriptor, {
    label: `${args.label}-recovered`,
    script: [{ step_id: 'route_compactor' }, ...validScript(descriptor)],
  });
  const recoveredTelemetry = validateSession(recovered.events);

  const compactorBlock = fragilePriorityBlock.blocked.find((b) => b.attempted === 'route_compactor');
  const exitBlock = earlyExitBlock.blocked.find((b) => b.attempted === 'scenario_completed');
  const checks = {
    descriptor_valid: descriptorCheck.ok,
    deterministic,
    telemetry_valid: telemetry.ok,
    shared_success: success.ok,
    compactor_blocked_before_fragile_and_priority:
      JSON.stringify(compactorBlock?.missing) === JSON.stringify(['sort_fragile_divert', 'priority_order_committed'])
      && compactorBlock?.recoverable === true
      && !fragilePriorityBlock.events.some((e) => e.event === 'scenario_completed'),
    exit_blocked_before_priority:
      exitBlock?.reason === 'beats_incomplete'
      && exitBlock?.missing.includes('priority_order_committed')
      && !earlyExitBlock.events.some((e) => e.event === 'scenario_completed'),
    invalid_first_recovered:
      recovered.completed_scenario && recovered.blocked.length > 0 && recoveredTelemetry.ok,
  };
  const ok = Object.values(checks).every(Boolean);
  const report = {
    concept_id: CONCEPT_ID,
    build_id: valid.build_id,
    build_hash: valid.build_hash,
    core_hash: valid.core_hash,
    active_ms: valid.active_ms,
    active_minutes: Number((valid.active_ms / 60000).toFixed(2)),
    checks,
    validation_errors: telemetry.errors,
    invalid_compactor: compactorBlock,
    invalid_exit: exitBlock,
    valid_event_names: valid.events.map((e) => e.event),
    ok,
  };

  if (args.out) {
    const out = resolve(args.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${CONCEPT_ID}.session.json`), `${JSON.stringify(valid, null, 2)}\n`);
    writeFileSync(join(out, `${CONCEPT_ID}.replay-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
