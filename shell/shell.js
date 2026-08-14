/**
 * Browser-side blank candidate shell.
 *
 * Deliberately imports the SAME core modules the headless smoke driver uses,
 * so the playable surface and the automated gate cannot drift apart. The
 * launcher serves /core/* alongside /shell/*.
 */

import { resolveInput, INPUT_MAP } from '/core/input.js';
import { validateSession, SCHEMA_VERSION } from '/core/telemetry.js';
import { blockedSteps, resolvePlayerAction, STEP_KINDS } from '/core/scenario-contract.js';

// Per-candidate build identity (architecture finding D4) is computed on the
// server from file contents and delivered via /bootstrap.json, because hashing
// source files is not possible in the browser. Never fall back to a shared ID.
let BUILD_ID = null;

const PROFILE_KEY_PREFIX = 'scv.profile.';
const PROFILE_VERSION = 1;

const state = {
  concept: null,
  identity: null,
  sessionId: null,
  events: [],
  sequence: 0,
  startedAt: null,
  coreActions: 0,
  beats: [],
  scenario: null,
  completedSteps: [],
  finished: false,
};

const el = (id) => document.getElementById(id);

// ------------------------------------------------------------------ profile

function profileKey(conceptId) {
  return `${PROFILE_KEY_PREFIX}${conceptId}`;
}

/**
 * Load a browser-side profile, healing corrupt or stale data into a clean one.
 * Mirrors core/profile.js semantics: a bad profile must never block a launch.
 */
function loadProfile(conceptId) {
  const blank = {
    version: PROFILE_VERSION,
    concept_id: conceptId,
    sessions_started: 0,
    sessions_completed: 0,
  };
  let raw;
  try {
    raw = window.localStorage.getItem(profileKey(conceptId));
  } catch {
    return { ...blank, recovered: true, recovery_reason: 'storage_unavailable' };
  }
  if (!raw) {
    saveProfile(blank);
    return { ...blank, recovered: false, recovery_reason: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    saveProfile(blank);
    return { ...blank, recovered: true, recovery_reason: 'corrupt_profile' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    saveProfile(blank);
    return { ...blank, recovered: true, recovery_reason: 'corrupt_profile' };
  }
  if (parsed.version !== PROFILE_VERSION) {
    saveProfile(blank);
    return { ...blank, recovered: true, recovery_reason: 'version_mismatch' };
  }
  if (parsed.concept_id !== conceptId) {
    saveProfile(blank);
    return { ...blank, recovered: true, recovery_reason: 'concept_mismatch' };
  }
  return { ...blank, ...parsed, recovered: false, recovery_reason: null };
}

function saveProfile(profile) {
  try {
    const copy = { ...profile };
    delete copy.recovered;
    delete copy.recovery_reason;
    window.localStorage.setItem(profileKey(copy.concept_id), JSON.stringify(copy));
  } catch {
    /* storage unavailable: the session still plays, it just will not persist */
  }
}

function resetProfile(conceptId) {
  const blank = {
    version: PROFILE_VERSION,
    concept_id: conceptId,
    sessions_started: 0,
    sessions_completed: 0,
  };
  saveProfile(blank);
  return blank;
}

// ---------------------------------------------------------------- telemetry

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function emit(name, payload = {}) {
  if (!state.sessionId || !BUILD_ID) return null;
  state.sequence += 1;
  const event = {
    schema_version: SCHEMA_VERSION,
    event: name,
    concept_id: state.concept.concept_id,
    build_id: BUILD_ID,
    session_id: state.sessionId,
    sequence: state.sequence,
    t_ms: Date.now() - state.startedAt,
    payload,
  };
  state.events.push(event);
  renderLog();
  return event;
}

// ------------------------------------------------------------------- beats

const BEATS = [
  { key: 'session_started', label: 'Start the session' },
  { key: 'core_action_1', label: 'Perform the core action (1 of 3)' },
  { key: 'core_action_2', label: 'Perform the core action (2 of 3)' },
  { key: 'core_action_3', label: 'Perform the core action (3 of 3)' },
  { key: 'signature_reveal_seen', label: 'Trigger the signature reveal' },
  { key: 'choice_committed', label: 'Commit the meaningful choice' },
  { key: 'scenario_completed', label: 'Complete the scenario' },
  { key: 'session_ended', label: 'End the session' },
];

function beatIndex() {
  return state.beats.length;
}

function activeBeats() {
  if (!state.scenario) return BEATS;
  return [
    { key: 'session_started', label: 'Start the session' },
    ...state.scenario.steps.map((step) => ({ key: step.id, label: step.label ?? step.id })),
    { key: 'scenario_completed', label: 'Complete the scenario' },
    { key: 'session_ended', label: 'End the session' },
  ];
}

function nextBeat() {
  return activeBeats().find((beat) => !state.beats.includes(beat.key)) ?? null;
}

function completeBeat(key) {
  state.beats.push(key);
  renderBeats();
}

// ------------------------------------------------------------------ actions

function startSession() {
  if (state.sessionId) return setStatus('Session already started.', 'blocked');
  const profile = loadProfile(state.concept.concept_id);
  state.sessionId = uuid();
  state.startedAt = Date.now();
  state.events = [];
  state.sequence = 0;
  state.coreActions = 0;
  state.beats = [];
  state.completedSteps = [];
  state.finished = false;

  emit('session_started', {
    role: state.concept.role,
    target_minutes: state.concept.target_minutes,
    profile: profile.sessions_started === 0 ? 'fresh' : 'returning',
  });
  if (profile.recovered) {
    emit('profile_recovered', { reason: profile.recovery_reason });
    setStatus(`Profile was reset (${profile.recovery_reason}). Starting clean.`, 'blocked');
  }
  profile.sessions_started += 1;
  saveProfile(profile);
  completeBeat('session_started');
  if (!profile.recovered) {
    setStatus('Session started. Perform the core action three times (Space).');
  }
}

function runCandidateStep(kind, stepId = null) {
  if (!requireSession()) return;
  if (state.finished) return setStatus('Scenario already completed.', 'blocked');

  const step = state.scenario.steps.find(
    (candidateStep) => (stepId ? candidateStep.id === stepId : candidateStep.kind === kind)
      && !state.completedSteps.includes(candidateStep.id),
  );
  if (!step) return setStatus(stepId ? `No pending step ${stepId}.` : `No pending ${kind.replace('_', ' ')} step.`, 'blocked');

  const blocked = blockedSteps(state.scenario, state.completedSteps).find((entry) => entry.id === step.id);
  if (blocked) {
    emit('invalid_action_blocked', {
      attempted: step.id,
      reason: 'prerequisites_not_met',
      missing: blocked.missing,
    });
    return setStatus(`Blocked ${step.id}: missing ${blocked.missing.join(', ')}.`, 'blocked');
  }

  const eventName = STEP_KINDS[step.kind];
  const payload = { step_id: step.id, label: step.label ?? step.id };
  if (step.kind === 'core_action') {
    state.coreActions += 1;
    payload.repetition = state.coreActions;
    payload.action = state.concept.core_action;
    payload.transformation_visible = Boolean(step.transformation);
  } else if (step.kind === 'reveal') payload.reveal = state.concept.signature_reveal;
  else if (step.kind === 'choice') {
    payload.prompt = state.concept.choice;
    payload.option = 'option_a';
    payload.reversible = false;
  } else payload.subject = step.id;

  emit(eventName, payload);
  state.completedSteps.push(step.id);
  completeBeat(step.id);
  const transformation = step.transformation
    ? ` Transformation: ${step.transformation.before} -> ${step.transformation.after}.`
    : '';
  setStatus(`${step.label ?? step.id} complete.${transformation}`);
}

function coreAction() {
  if (state.scenario) return runCandidateStep('core_action');
  if (!requireSession()) return;
  if (state.finished) return setStatus('Scenario already completed.', 'blocked');
  state.coreActions += 1;
  emit('core_action_completed', {
    repetition: state.coreActions,
    action: state.concept.core_action,
    transformation_visible: true,
  });
  if (state.coreActions <= 3) completeBeat(`core_action_${state.coreActions}`);
  setStatus(
    state.coreActions >= 3
      ? 'Core action proven. Trigger the signature reveal (Q).'
      : `Core action ${state.coreActions} of 3.`,
  );
}

function signatureReveal() {
  if (state.scenario) return runCandidateStep('reveal');
  if (!requireSession()) return;
  // Gate: the reveal must follow the repeated action, never precede it.
  if (state.coreActions < 3) {
    emit('invalid_action_blocked', { attempted: 'signature_reveal_seen', reason: 'core_action_min_not_met' });
    return setStatus('Blocked: perform the core action at least three times first.', 'blocked');
  }
  if (state.beats.includes('signature_reveal_seen')) return setStatus('Reveal already seen.', 'blocked');
  emit('signature_reveal_seen', { reveal: state.concept.signature_reveal });
  completeBeat('signature_reveal_seen');
  setStatus(`Reveal: ${state.concept.signature_reveal} — now commit your choice (F).`);
}

function commitChoice() {
  if (state.scenario) return runCandidateStep('choice');
  if (!requireSession()) return;
  if (!state.beats.includes('signature_reveal_seen')) {
    emit('invalid_action_blocked', { attempted: 'choice_committed', reason: 'reveal_not_seen' });
    return setStatus('Blocked: the signature reveal must come first.', 'blocked');
  }
  if (state.beats.includes('choice_committed')) return setStatus('Choice already committed.', 'blocked');
  emit('choice_committed', { prompt: state.concept.choice, option: 'option_a', reversible: false });
  completeBeat('choice_committed');
  setStatus('Choice committed. Press Enter to complete the scenario.');
}

function advance() {
  if (!state.sessionId) return startSession();
  if (state.finished) return setStatus('Session finished. Export or reset.', 'done');

  const candidateIncomplete = state.scenario
    && state.scenario.steps.some((step) => !state.completedSteps.includes(step.id));
  if (candidateIncomplete || (!state.scenario && !state.beats.includes('choice_committed'))) {
    emit('invalid_action_blocked', { attempted: 'scenario_completed', reason: 'beats_incomplete' });
    const beat = nextBeat();
    return setStatus(`Blocked: ${beat ? beat.label : 'earlier beats'} still pending.`, 'blocked');
  }

  const activeMs = Date.now() - state.startedAt;
  emit('scenario_completed', { core_actions: state.coreActions, unassisted: true, active_ms: activeMs });
  completeBeat('scenario_completed');
  emit('next_hook_shown', { hook: state.concept.next_hook });
  emit('session_ended', { reason: 'scenario_completed', active_ms: activeMs });
  completeBeat('session_ended');
  state.finished = true;

  const profile = loadProfile(state.concept.concept_id);
  profile.sessions_completed += 1;
  saveProfile(profile);

  setStatus(`Scenario complete. Next: ${state.concept.next_hook}`, 'done');
  runValidation();
}

function requireSession() {
  if (!state.sessionId) {
    setStatus('Press Enter to start the session first.', 'blocked');
    return false;
  }
  return true;
}

// ------------------------------------------------------------------ render

function setStatus(msg, kind = '') {
  const node = el('status');
  node.textContent = msg;
  node.className = `status ${kind}`.trim();
}

function renderBeats() {
  const list = el('beats');
  list.innerHTML = '';
  const beats = activeBeats();
  beats.forEach((b) => {
    const li = document.createElement('li');
    li.textContent = b.label;
    if (state.beats.includes(b.key)) li.className = 'done';
    else if (b.key === nextBeat()?.key) li.className = 'active';
    list.appendChild(li);
  });
  el('progress-fill').style.width = `${(state.beats.length / beats.length) * 100}%`;
}

function renderLog() {
  el('event-count').textContent = `(${state.events.length} events)`;
  el('log').textContent = state.events.length
    ? state.events.map((e) => `${String(e.sequence).padStart(2, '0')}  ${String(e.t_ms).padStart(6)}ms  ${e.event}`).join('\n')
    : 'no events yet';
}

function runValidation() {
  const r = validateSession(state.events);
  const node = el('validation');
  node.textContent = r.ok
    ? 'Telemetry validates against the shared schema.'
    : `Telemetry INVALID: ${r.errors.join('; ')}`;
  node.className = `validation ${r.ok ? 'ok' : 'bad'}`;
}

function renderControls() {
  const list = el('controls');
  list.innerHTML = '';
  for (const [verb, binding] of Object.entries(INPUT_MAP)) {
    const li = document.createElement('li');
    li.innerHTML = `<kbd>${binding.keyboard.join('</kbd> <kbd>')}</kbd> — ${binding.label} <span class="mono">(${verb})</span>`;
    list.appendChild(li);
  }
  for (const action of state.scenario?.player_actions ?? []) {
    const li = document.createElement('li');
    li.innerHTML = `<kbd>${action.keyboard.join('</kbd> <kbd>')}</kbd> — ${action.label ?? action.step_id} <span class="mono">(${action.id})</span>`;
    list.appendChild(li);
  }
}

function exportSession() {
  const payload = {
    concept_id: state.concept.concept_id,
    build_id: BUILD_ID,
    build_hash: state.identity?.build_hash ?? null,
    core_hash: state.identity?.core_hash ?? null,
    session_id: state.sessionId,
    events: state.events,
    validation: validateSession(state.events),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.concept.concept_id}.session.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// -------------------------------------------------------------------- boot

async function boot() {
  const res = await fetch('/bootstrap.json');
  const bootstrap = await res.json();
  state.concept = bootstrap.concept;
  state.identity = bootstrap.build_identity;
  state.scenario = bootstrap.scenario;
  BUILD_ID = bootstrap.build_identity.build_id;

  document.title = `${bootstrap.concept.title} - validation shell`;
  el('build-id').textContent = BUILD_ID;
  el('concept-title').textContent = bootstrap.concept.title;
  el('concept-role').textContent = bootstrap.concept.role;
  el('concept-core-action').textContent = bootstrap.concept.core_action;
  el('concept-reveal').textContent = bootstrap.concept.signature_reveal;
  el('concept-choice').textContent = bootstrap.concept.choice;
  el('concept-hook').textContent = bootstrap.concept.next_hook;
  el('concept-target').textContent = `${bootstrap.concept.target_minutes.min}-${bootstrap.concept.target_minutes.max} minutes`;
  if (bootstrap.scenario) {
    el('shell-hint').textContent = `Candidate scenario loaded: ${bootstrap.scenario.steps.length} ordered steps. Use E / Space / Q / F according to each step kind.`;
  }

  renderControls();
  renderBeats();
  renderLog();

  window.addEventListener('keydown', (ev) => {
    const playerAction = resolvePlayerAction(state.scenario, ev.code);
    if (playerAction) {
      ev.preventDefault();
      runCandidateStep(null, playerAction.step_id);
      return;
    }
    const verb = resolveInput(ev.code);
    if (!verb) return;
    ev.preventDefault();
    if (verb === 'core_action') coreAction();
    else if (verb === 'inspect') signatureReveal();
    else if (verb === 'commit_choice') commitChoice();
    else if (verb === 'advance') advance();
    else if (verb === 'interact') {
      if (state.scenario) runCandidateStep('inspect');
      else emit('inspect_performed', { subject: 'scenario_objective' });
    }
    else if (verb === 'reset_profile') {
      resetProfile(state.concept.concept_id);
      setStatus('Profile reset to a clean state. Press Enter to start a fresh session.');
    }
  });

  el('export-btn').addEventListener('click', exportSession);
  el('reset-btn').addEventListener('click', () => {
    resetProfile(state.concept.concept_id);
    setStatus('Profile reset to a clean state. Press Enter to start a fresh session.');
  });

  // Expose a minimal hook for headless manual-QA drivers. Read-only surface.
  window.__scv = {
    getState: () => ({ ...state }),
    validate: () => validateSession(state.events),
  };
}

boot();
