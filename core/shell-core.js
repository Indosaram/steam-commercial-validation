/**
 * The blank candidate shell.
 *
 * This is the common playable skeleton every candidate build (Tasks 2-6) will
 * fill in. It contains NO candidate-specific content: no art, no puzzle logic,
 * no scenario polish. What it does own is the shared beat structure that makes
 * five different builds comparable:
 *
 *   session_started -> (core_action_completed x3+) -> signature_reveal_seen
 *   -> choice_committed -> scenario_completed -> session_ended
 *
 * `runScenario` is the deterministic scripted play-through used by the smoke
 * driver and by candidate replay drivers. Given the same seed it emits an
 * identical event stream, which is what makes the smoke test a real regression
 * gate rather than a coin flip.
 */

import { getConcept } from './concepts.js';
import { SCHEMA_VERSION } from './telemetry.js';
import { buildIdentity } from './build-identity.js';

/**
 * Legacy shared identifier, kept only as the foundation's own version marker.
 * Do NOT put this in telemetry: architecture finding D4 requires a per-candidate
 * build_id so five candidates stay distinguishable. Use buildIdentity(conceptId).
 */
export const BUILD_ID = 'foundation-0.1.0';

/** Deterministic 32-bit PRNG (mulberry32). No Math.random anywhere in this path. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a stable, UUID-shaped session ID from concept + seed.
 * Deterministic on purpose: replaying a seed must reproduce the exact stream.
 */
function deterministicSessionId(conceptId, seed) {
  const rand = mulberry32(seed + hashString(conceptId));
  const hex = [];
  for (let i = 0; i < 32; i += 1) {
    hex.push(Math.floor(rand() * 16).toString(16));
  }
  const s = hex.join('');
  // Force version 4 / variant 8 nibbles so it satisfies the UUID shape check.
  return [
    s.slice(0, 8),
    s.slice(8, 12),
    `4${s.slice(13, 16)}`,
    `8${s.slice(17, 20)}`,
    s.slice(20, 32),
  ].join('-');
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Scripted active play per beat, budgeted so the total lands inside the
 * 10-15 minute target window at BOTH ends of the repetition range:
 *   fixed beats = intro 80 + reveal 80 + choice 90 + wrap 70 = 320s
 *   3 reps -> 320 + 3*110 = 650s = 10.83 min
 *   5 reps -> 320 + 5*110 = 870s = 14.50 min
 * Any change here must keep both bounds inside the window; the
 * "active duration lands inside the 10-15 minute target window" test
 * enforces it across all five concepts.
 */
const BEAT_PLAN = Object.freeze({
  intro_ms: 80_000,
  per_core_action_ms: 110_000,
  reveal_ms: 80_000,
  choice_ms: 90_000,
  wrap_ms: 70_000,
});

/**
 * Run one deterministic scripted scenario for a concept.
 *
 * @param {{conceptId?: string, seed?: number, coreActions?: number}} args
 * @returns {{concept_id: string, build_id: string, session_id: string,
 *            events: object[], active_ms: number, summary: object}}
 * @throws {Error} when concept_id is missing or unknown
 */
export function runScenario({ conceptId, seed = 1, coreActions } = {}) {
  // Acceptance criterion: a launch without a concept_id must be rejected.
  const concept = getConcept(conceptId);

  const rand = mulberry32(seed + hashString(concept.concept_id));
  const sessionId = deterministicSessionId(concept.concept_id, seed);
  // Per-candidate build identity (D4): derived from shared core + this
  // candidate's own sources, so the Task 7 comparison can tell builds apart.
  const identity = buildIdentity(concept.concept_id);

  // 3-5 repetitions: the shared contract demands at least three.
  const reps = coreActions ?? 3 + Math.floor(rand() * 3);

  const events = [];
  let sequence = 0;
  let t = 0;

  const emit = (name, payload = {}) => {
    sequence += 1;
    events.push({
      schema_version: SCHEMA_VERSION,
      event: name,
      concept_id: concept.concept_id,
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

  t += BEAT_PLAN.intro_ms;
  emit('inspect_performed', { subject: 'scenario_objective' });

  for (let i = 1; i <= reps; i += 1) {
    t += BEAT_PLAN.per_core_action_ms;
    emit('core_action_completed', {
      repetition: i,
      action: concept.core_action,
      transformation_visible: true,
    });
  }

  t += BEAT_PLAN.reveal_ms;
  emit('signature_reveal_seen', { reveal: concept.signature_reveal });

  t += BEAT_PLAN.choice_ms;
  emit('choice_committed', {
    prompt: concept.choice,
    // The blank shell always takes the first option; candidate builds replace
    // this with a real player decision surface.
    option: 'option_a',
    reversible: false,
  });

  t += BEAT_PLAN.wrap_ms;
  emit('scenario_completed', {
    core_actions: reps,
    unassisted: true,
    active_ms: t,
  });

  emit('next_hook_shown', { hook: concept.next_hook });
  emit('session_ended', { reason: 'scenario_completed', active_ms: t });

  return {
    concept_id: concept.concept_id,
    build_id: identity.build_id,
    build_hash: identity.build_hash,
    core_hash: identity.core_hash,
    candidate_present: identity.candidate_present,
    session_id: sessionId,
    seed,
    events,
    active_ms: t,
    summary: {
      core_actions: reps,
      active_minutes: Number((t / 60000).toFixed(2)),
      signature_reveal: concept.signature_reveal,
      choice: concept.choice,
      next_hook: concept.next_hook,
    },
  };
}

/**
 * The shared success condition, evaluated against a finished run. This is the
 * single definition every candidate is measured by.
 * @param {{events: object[], active_ms: number}} session
 */
export function evaluateSuccessCondition(session) {
  const names = session.events.map((e) => e.event);
  const coreActions = names.filter((n) => n === 'core_action_completed').length;
  const minutes = session.active_ms / 60000;
  const checks = {
    completed_unassisted: names.includes('scenario_completed'),
    core_action_repeated_3x: coreActions >= 3,
    signature_reveal_triggered: names.includes('signature_reveal_seen'),
    meaningful_choice_made: names.includes('choice_committed'),
    next_scenario_hook_shown: names.includes('next_hook_shown'),
    within_target_window: minutes >= 10 && minutes <= 15,
  };
  return { ok: Object.values(checks).every(Boolean), checks, active_minutes: Number(minutes.toFixed(2)) };
}
