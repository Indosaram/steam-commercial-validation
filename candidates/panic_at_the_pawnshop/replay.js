/**
 * PANIC! AT THE PAWNSHOP - deterministic replay driver.
 *
 * Drives the shift descriptor through the SHARED prerequisite gate
 * (core/scenario-contract.js `blockedSteps`) and emits the SHARED telemetry
 * schema, so this candidate is measured by the same rules as the other four.
 * It does not reimplement gating and it does not edit shared code.
 *
 * Three modes, all fully deterministic - no random source or wall clock:
 *
 *   evidence_supported       (default) the happy shift: every appraisal is
 *                            backed by that item's two evidence findings.
 *   appraise_without_evidence         attempts an appraisal cold; the shared
 *                            gate blocks it and names the missing evidence.
 *   contradict_evidence      commits an appraisal that contradicts the recorded
 *                            findings; a NAMED, EXPLAINED, RECOVERABLE
 *                            consequence is applied and the shift still closes.
 *
 * Usage:
 *   node candidates/panic_at_the_pawnshop/replay.js [--mode <m>] [--out <dir>]
 */

import { SCHEMA_VERSION } from '../../core/telemetry.js';
import { buildIdentity } from '../../core/build-identity.js';
import { getConcept } from '../../core/concepts.js';
import { blockedSteps, STEP_KINDS } from '../../core/scenario-contract.js';

import descriptor, { ITEMS } from './scenario.js';

const CONCEPT_ID = 'panic_at_the_pawnshop';

/** Evidence tools this shift can use. */
export const EVIDENCE_TOOLS = Object.freeze([...descriptor.evidence_tools]);

/** The three items on the counter, in shift order. */
export const ITEM_IDS = Object.freeze(ITEMS.map((i) => i.item_id));

export const REPLAY_MODES = Object.freeze([
  'evidence_supported',
  'appraise_without_evidence',
  'contradict_evidence',
]);

/**
 * Scripted active play per beat, budgeted so the whole shift lands inside the
 * shared 10-15 minute window:
 *   open 55s + 6 evidence x 48s + 3 appraisals x 76s + reveal 95s + choice 85s
 *   + wrap 40s = 55 + 288 + 228 + 95 + 85 + 40 = 791s = 13.18 min.
 * The "lands inside the 10-15 minute target window" test enforces this.
 */
const BEAT_MS = Object.freeze({
  open_shift: 55_000,
  evidence: 48_000,
  appraisal: 76_000,
  reveal: 95_000,
  choice: 85_000,
  wrap: 40_000,
});

/** Deterministic UUID-shaped session id derived from concept + seed + mode. */
function sessionIdFor(seed, mode) {
  let h = 2166136261 >>> 0;
  for (const ch of `${CONCEPT_ID}:${seed}:${mode}`) {
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

const stepById = (id) => descriptor.steps.find((s) => s.id === id);
const itemById = (id) => ITEMS.find((i) => i.item_id === id);
const evidenceStepsFor = (itemId) =>
  descriptor.steps.filter((s) => s.item === itemId && s.kind === 'inspect');

function beatDuration(step) {
  if (step.id === 'open_shift') return BEAT_MS.open_shift;
  if (step.kind === 'inspect') return BEAT_MS.evidence;
  if (step.kind === 'core_action') return BEAT_MS.appraisal;
  if (step.kind === 'reveal') return BEAT_MS.reveal;
  if (step.kind === 'choice') return BEAT_MS.choice;
  return 0;
}

/**
 * Run one deterministic shift replay.
 *
 * @param {{seed?: number, mode?: string}} args
 * @returns {{concept_id: string, build_id: string, session_id: string, mode: string,
 *            events: object[], active_ms: number, outcomes: object[],
 *            ok: boolean, failures: string[]}}
 */
export function runReplay({ seed = 1, mode = 'evidence_supported' } = {}) {
  if (!REPLAY_MODES.includes(mode)) {
    throw new Error(`unknown replay mode "${mode}"; expected one of: ${REPLAY_MODES.join(', ')}`);
  }
  const concept = getConcept(CONCEPT_ID);
  const identity = buildIdentity(CONCEPT_ID);
  const sessionId = sessionIdFor(seed, mode);

  const events = [];
  const outcomes = [];
  const completed = [];
  const recordedEvidence = new Map(); // item_id -> [{step_id, tool, finding, supports}]
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
    mode,
    items: ITEM_IDS,
  });

  /**
   * Attempt one descriptor step through the SHARED gate. A blocked step emits
   * invalid_action_blocked naming exactly what is missing, and is not applied.
   */
  const attempt = (stepId, extraPayload = {}) => {
    const step = stepById(stepId);
    const blocked = blockedSteps(descriptor, completed).find((b) => b.id === stepId);
    if (blocked) {
      // Translate the shared prerequisite gate into this scenario's vocabulary:
      // for an appraisal, an unmet prerequisite IS missing evidence.
      const reason = step.kind === 'core_action' ? 'evidence_missing' : 'prerequisites_not_met';
      emit('invalid_action_blocked', {
        attempted: stepId,
        item: step.item ?? null,
        reason,
        missing: blocked.missing,
        explanation:
          step.kind === 'core_action'
            ? `Appraisal refused: ${step.item} has no recorded evidence from ${blocked.missing.join(' and ')}. Inspect first, then book the ticket.`
            : `Blocked: ${stepId} still needs ${blocked.missing.join(', ')}.`,
      });
      return false;
    }

    t += beatDuration(step);
    const eventName = STEP_KINDS[step.kind];
    const payload = { step_id: step.id, label: step.label, ...extraPayload };

    if (step.kind === 'inspect') {
      payload.tool = step.tool ?? null;
      payload.item = step.item ?? null;
      payload.finding = step.finding;
      payload.evidence_kind = step.evidence_kind;
      payload.supports = step.supports ?? null;
      if (step.item) {
        const list = recordedEvidence.get(step.item) ?? [];
        list.push({ step_id: step.id, tool: step.tool, finding: step.finding, supports: step.supports });
        recordedEvidence.set(step.item, list);
      }
    } else if (step.kind === 'core_action') {
      Object.assign(payload, appraisalPayload(step, mode, recordedEvidence, outcomes));
      payload.action = concept.core_action;
      payload.transformation_visible = true;
    } else if (step.kind === 'reveal') {
      payload.reveal = concept.signature_reveal;
      payload.finding = step.finding;
      payload.evidence_chain = ITEM_IDS.map((id) => ({
        item: id,
        findings: (recordedEvidence.get(id) ?? []).map((e) => e.step_id),
      }));
    } else if (step.kind === 'choice') {
      payload.prompt = concept.choice;
      payload.option = 'file_the_scheme_with_the_shift_report';
      payload.reversible = false;
      payload.based_on = outcomes.map((o) => o.item_id);
    }
    if (step.transformation) payload.transformation = step.transformation;

    emit(eventName, payload);
    completed.push(stepId);
    return true;
  };

  if (mode === 'appraise_without_evidence') {
    // Invalid-first: try to book every ticket before inspecting anything.
    // The shared gate must refuse all three by name.
    for (const itemId of ITEM_IDS) {
      const appraisal = descriptor.steps.find((s) => s.item === itemId && s.kind === 'core_action');
      attempt(appraisal.id);
    }
    t += BEAT_MS.wrap;
    emit('session_ended', { reason: 'unsupported_appraisals_refused', active_ms: t, mode });

    const blockedCount = events.filter((e) => e.event === 'invalid_action_blocked').length;
    const failures = [];
    if (blockedCount !== ITEM_IDS.length) {
      failures.push(`expected ${ITEM_IDS.length} refused appraisals, got ${blockedCount}`);
    }
    if (events.some((e) => e.event === 'core_action_completed')) {
      failures.push('an appraisal landed without evidence');
    }
    return {
      concept_id: CONCEPT_ID,
      build_id: identity.build_id,
      build_hash: identity.build_hash,
      session_id: sessionId,
      seed,
      mode,
      events,
      outcomes,
      active_ms: t,
      // This mode is a probe, not a completed shift: it must NOT report ok.
      ok: false,
      failures,
      blocked_as_expected: failures.length === 0,
    };
  }

  for (const stepId of descriptor.replay) attempt(stepId);

  t += BEAT_MS.wrap;
  emit('scenario_completed', {
    core_actions: outcomes.length,
    items_appraised: outcomes.map((o) => o.item_id),
    unassisted: true,
    active_ms: t,
    mode,
  });
  emit('next_hook_shown', { hook: concept.next_hook, next_shift: descriptor.next_shift_hook });
  emit('session_ended', { reason: 'scenario_completed', active_ms: t, mode });

  const names = events.map((e) => e.event);
  const failures = [];
  for (const required of [
    'session_started',
    'core_action_completed',
    'signature_reveal_seen',
    'choice_committed',
    'scenario_completed',
    'session_ended',
  ]) {
    if (!names.includes(required)) failures.push(`missing required event ${required}`);
  }
  if (outcomes.length !== ITEM_IDS.length) {
    failures.push(`expected ${ITEM_IDS.length} appraisals, got ${outcomes.length}`);
  }
  const minutes = t / 60000;
  if (minutes < 10 || minutes > 15) failures.push(`active play ${minutes.toFixed(2)} min is outside 10-15`);

  return {
    concept_id: CONCEPT_ID,
    build_id: identity.build_id,
    build_hash: identity.build_hash,
    session_id: sessionId,
    seed,
    mode,
    events,
    outcomes,
    active_ms: t,
    active_minutes: Number(minutes.toFixed(2)),
    ok: failures.length === 0,
    failures,
  };
}

/**
 * Resolve one appraisal from the evidence recorded for that item.
 *
 * evidence_supported : take the verdict the findings support.
 * contradict_evidence: take the authored contradicting verdict and apply its
 *                      NAMED, EXPLAINED, RECOVERABLE consequence. Nothing here
 *                      is random - the outcome is a stated function of the
 *                      verdict the player committed versus the evidence on file.
 */
function appraisalPayload(step, mode, recordedEvidence, outcomes) {
  const item = itemById(step.item);
  const evidence = recordedEvidence.get(item.item_id) ?? [];
  const evidenceIds = evidence.map((e) => e.step_id);
  const contradicting = mode === 'contradict_evidence';

  const appraisal = contradicting ? item.contradiction.appraisal : item.correct_appraisal;
  const supported = !contradicting;

  const outcome = {
    item_id: item.item_id,
    display_name: item.display_name,
    truth: item.truth,
    appraisal,
    disposition: supported ? item.correct_disposition : 'reopen_required',
    offer: supported ? item.offer : null,
    evidence_used: evidenceIds,
    evidence_tools: evidence.map((e) => e.tool),
    evidence_supported: supported,
    consequence: supported ? item.consequence : item.contradiction.explanation,
    consequence_applied: !supported,
    consequence_name: supported ? null : item.contradiction.name,
    recoverable: supported ? null : true,
    recovery: supported ? null : item.contradiction.recovery,
  };
  outcomes.push(outcome);

  const payload = {
    item: item.item_id,
    display_name: item.display_name,
    appraisal,
    disposition: outcome.disposition,
    offer: outcome.offer,
    evidence_used: evidenceIds,
    evidence_tools: outcome.evidence_tools,
    evidence_supported: supported,
    consequence: outcome.consequence,
  };

  if (contradicting) {
    payload.contradicts_evidence = true;
    payload.contradicted_evidence = item.contradiction.contradicts;
    payload.consequence_name = item.contradiction.name;
    payload.consequence_explanation = item.contradiction.explanation;
    payload.recoverable = true;
    payload.recovery = item.contradiction.recovery;
  }
  return payload;
}

/** Human-readable shift report for evidence archives. */
export function renderShiftReport(run) {
  const lines = [
    `# PANIC! AT THE PAWNSHOP - shift report`,
    ``,
    `mode        : ${run.mode}`,
    `build_id    : ${run.build_id}`,
    `session_id  : ${run.session_id}`,
    `active play : ${(run.active_ms / 60000).toFixed(2)} minutes`,
    `result      : ${run.ok ? 'SHIFT COMPLETE' : run.mode === 'appraise_without_evidence' ? 'REFUSED (probe)' : 'INCOMPLETE'}`,
    ``,
    `## Evidence recorded`,
    ``,
  ];
  for (const e of run.events.filter((ev) => ev.event === 'inspect_performed' && ev.payload.tool)) {
    lines.push(`- [${e.payload.item}] ${e.payload.tool}: ${e.payload.finding}`);
  }
  lines.push('', '## Appraisals', '');
  for (const o of run.outcomes) {
    lines.push(`### ${o.display_name}`);
    lines.push(`- appraisal        : ${o.appraisal}`);
    lines.push(`- disposition      : ${o.disposition}`);
    lines.push(`- offer            : ${o.offer === null ? 'none' : o.offer}`);
    lines.push(`- evidence used    : ${o.evidence_used.join(', ')} (${o.evidence_tools.join(', ')})`);
    lines.push(`- evidence-backed  : ${o.evidence_supported ? 'yes' : 'NO'}`);
    if (o.consequence_name) {
      lines.push(`- consequence      : ${o.consequence_name} - ${o.consequence}`);
      lines.push(`- recoverable      : yes - ${o.recovery}`);
    } else {
      lines.push(`- consequence      : ${o.consequence}`);
    }
    lines.push('');
  }
  const blocked = run.events.filter((e) => e.event === 'invalid_action_blocked');
  if (blocked.length) {
    lines.push('## Refused actions', '');
    for (const b of blocked) {
      lines.push(`- ${b.payload.attempted} (${b.payload.reason}; missing ${b.payload.missing.join(', ')})`);
      lines.push(`  ${b.payload.explanation}`);
    }
    lines.push('');
  }
  const reveal = run.events.find((e) => e.event === 'signature_reveal_seen');
  if (reveal) lines.push('## Reveal', '', reveal.payload.finding, '');
  const hook = run.events.find((e) => e.event === 'next_hook_shown');
  if (hook) lines.push('## Next shift', '', hook.payload.next_shift, '');
  return lines.join('\n');
}

// ------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { mode: 'evidence_supported', seed: 1, out: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`${err.message}\nmodes: ${REPLAY_MODES.join(', ')}\n`);
    process.exit(2);
  }
  if (!REPLAY_MODES.includes(args.mode)) {
    process.stderr.write(`unknown --mode "${args.mode}"; expected one of: ${REPLAY_MODES.join(', ')}\n`);
    process.exit(2);
  }
  if (!Number.isFinite(args.seed)) {
    process.stderr.write('--seed must be a number\n');
    process.exit(2);
  }

  const run = runReplay({ seed: args.seed, mode: args.mode });
  const report = renderShiftReport(run);
  process.stdout.write(`${report}\n`);

  if (args.out) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const dir = resolve(args.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${CONCEPT_ID}.${args.mode}.session.json`),
      `${JSON.stringify({ concept: descriptor.title, ...run }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(join(dir, `${CONCEPT_ID}.${args.mode}.report.md`), `${report}\n`, 'utf8');
    process.stdout.write(`artifacts: ${dir}\n`);
  }

  const success = args.mode === 'appraise_without_evidence' ? run.blocked_as_expected : run.ok;
  if (!success) for (const f of run.failures) process.stderr.write(`! ${f}\n`);
  process.exit(success ? 0 : 1);
}

// Only run the CLI when executed directly, never on import.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
