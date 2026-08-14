/**
 * Session telemetry schema + validator shared by all five candidate builds.
 *
 * Design constraints from the plan:
 *  - one validated JSON schema for every candidate
 *  - the six required common events must all appear in a completed session
 *  - omitted concept_id / build_id / session_id must be rejected by name
 *  - unsupported event names must be rejected
 *
 * The validator is dependency-free on purpose: the workspace must stay
 * launchable with a bare Node install and no package registry access.
 */

import { isConceptId, CONCEPT_IDS } from './concepts.js';

export const SCHEMA_VERSION = 1;

/** The six required common events, in required causal order. */
export const REQUIRED_EVENTS = Object.freeze([
  'session_started',
  'core_action_completed',
  'signature_reveal_seen',
  'choice_committed',
  'scenario_completed',
  'session_ended',
]);

/**
 * Supported event names. Required events plus a small set of optional
 * observational events candidates may emit. Anything else is rejected, which
 * is what keeps candidate builds from inventing divergent vocabularies.
 */
export const EVENT_NAMES = Object.freeze([
  ...REQUIRED_EVENTS,
  'profile_created',
  'profile_reset',
  'profile_recovered',
  'inspect_performed',
  'invalid_action_blocked',
  'next_hook_shown',
]);

const EVENT_NAME_SET = new Set(EVENT_NAMES);

/** Fields every event must carry. Order matters for stable error output. */
const REQUIRED_FIELDS = Object.freeze([
  'schema_version',
  'event',
  'concept_id',
  'build_id',
  'session_id',
  'sequence',
  't_ms',
]);

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a single telemetry event.
 * @param {unknown} event
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateEvent(event) {
  const errors = [];

  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: ['event must be a JSON object'] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(event, field) || event[field] === null || event[field] === undefined) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(event, 'schema_version') && event.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(event.schema_version)}`);
  }

  if (typeof event.event === 'string' && !EVENT_NAME_SET.has(event.event)) {
    errors.push(
      `unsupported event name "${event.event}"; expected one of: ${EVENT_NAMES.join(', ')}`,
    );
  }

  if (typeof event.concept_id === 'string' && !isConceptId(event.concept_id)) {
    errors.push(
      `invalid concept_id "${event.concept_id}"; expected one of: ${CONCEPT_IDS.join(', ')}`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(event, 'build_id') && typeof event.build_id !== 'string') {
    errors.push('build_id must be a string');
  } else if (typeof event.build_id === 'string' && event.build_id.trim() === '') {
    errors.push('build_id must not be empty');
  }

  if (typeof event.session_id === 'string' && !SESSION_ID_RE.test(event.session_id)) {
    errors.push(`session_id must be a UUID, got "${event.session_id}"`);
  }

  if (Object.prototype.hasOwnProperty.call(event, 'sequence')) {
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      errors.push('sequence must be a positive integer');
    }
  }

  if (Object.prototype.hasOwnProperty.call(event, 't_ms')) {
    if (!Number.isFinite(event.t_ms) || event.t_ms < 0) {
      errors.push('t_ms must be a non-negative finite number');
    }
  }

  if (Object.prototype.hasOwnProperty.call(event, 'payload')) {
    const p = event.payload;
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      errors.push('payload must be a JSON object when present');
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a whole session event stream: every event individually valid, one
 * concept and one session throughout, monotonic sequence/time, all six required
 * events present, and required events in causal order.
 *
 * @param {unknown} events
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSession(events) {
  const errors = [];

  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, errors: ['session must be a non-empty array of events'] };
  }

  events.forEach((event, i) => {
    const r = validateEvent(event);
    for (const e of r.errors) errors.push(`event[${i}]: ${e}`);
  });

  // Bail out early: ordering checks on malformed events produce noise.
  if (errors.length > 0) return { ok: false, errors };

  const conceptIds = new Set(events.map((e) => e.concept_id));
  if (conceptIds.size > 1) {
    errors.push(`session mixes multiple concept_id values: ${[...conceptIds].join(', ')}`);
  }

  const sessionIds = new Set(events.map((e) => e.session_id));
  if (sessionIds.size > 1) {
    errors.push(`session mixes multiple session_id values: ${[...sessionIds].join(', ')}`);
  }

  const buildIds = new Set(events.map((e) => e.build_id));
  if (buildIds.size > 1) {
    errors.push(`session mixes multiple build_id values: ${[...buildIds].join(', ')}`);
  }

  for (let i = 1; i < events.length; i += 1) {
    if (events[i].sequence <= events[i - 1].sequence) {
      errors.push(
        `sequence must strictly increase: event[${i}] sequence ${events[i].sequence} follows ${events[i - 1].sequence}`,
      );
    }
    if (events[i].t_ms < events[i - 1].t_ms) {
      errors.push(`t_ms must not go backwards: event[${i}] t_ms ${events[i].t_ms} follows ${events[i - 1].t_ms}`);
    }
  }

  const names = events.map((e) => e.event);
  for (const required of REQUIRED_EVENTS) {
    if (!names.includes(required)) {
      errors.push(`session is missing required event: ${required}`);
    }
  }

  // Causal order: first occurrence of each required event must follow the
  // required sequence. This is what catches "completed before you played".
  const firstIndex = (name) => names.indexOf(name);
  const present = REQUIRED_EVENTS.filter((n) => names.includes(n));
  for (let i = 1; i < present.length; i += 1) {
    const prev = present[i - 1];
    const cur = present[i];
    if (firstIndex(cur) < firstIndex(prev)) {
      errors.push(`required event out of causal order: ${cur} occurs before ${prev}`);
    }
  }

  if (names[0] !== 'session_started') {
    errors.push(`session must open with session_started, got ${names[0]}`);
  }
  if (names[names.length - 1] !== 'session_ended') {
    errors.push(`session must close with session_ended, got ${names[names.length - 1]}`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Machine-readable schema description, exported for evidence archives and for
 * candidate builds that want to assert conformance at build time.
 */
export function schemaDescriptor() {
  return {
    schema_version: SCHEMA_VERSION,
    required_fields: [...REQUIRED_FIELDS],
    required_events: [...REQUIRED_EVENTS],
    supported_events: [...EVENT_NAMES],
    concept_ids: [...CONCEPT_IDS],
    session_id_format: 'uuid-v4-shaped, hex with dashes',
    ordering_rules: [
      'sequence strictly increases within a session',
      't_ms never decreases within a session',
      'first occurrences of the six required events follow their listed causal order',
      'stream opens with session_started and closes with session_ended',
    ],
  };
}
