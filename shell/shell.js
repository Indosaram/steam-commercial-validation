import { initCanvasRenderer } from './canvas-renderer.js';
import { resolveInput, INPUT_MAP } from '/core/input.js';
import { validateSession, SCHEMA_VERSION } from '/core/telemetry.js';
import { blockedSteps, resolvePlayerAction, STEP_KINDS } from '/core/scenario-contract.js';

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

const dummyNode = { textContent: '', innerHTML: '', className: '', style: {}, appendChild: () => {}, addEventListener: () => {} };
const el = (id) => document.getElementById(id) || dummyNode;

function profileKey(conceptId) { return `${PROFILE_KEY_PREFIX}${conceptId}`; }

function loadProfile(conceptId) {
  const blank = { version: PROFILE_VERSION, concept_id: conceptId, sessions_started: 0, sessions_completed: 0 };
  try {
    const raw = window.localStorage.getItem(profileKey(conceptId));
    if (!raw) return { ...blank, recovered: false, recovery_reason: null };
    const parsed = JSON.parse(raw);
    return { ...blank, ...parsed, recovered: false, recovery_reason: null };
  } catch {
    return { ...blank, recovered: true, recovery_reason: 'storage_unavailable' };
  }
}

function saveProfile(profile) {
  try {
    const copy = { ...profile };
    delete copy.recovered; delete copy.recovery_reason;
    window.localStorage.setItem(profileKey(copy.concept_id), JSON.stringify(copy));
  } catch {}
}

function resetProfile(conceptId) {
  const blank = { version: PROFILE_VERSION, concept_id: conceptId, sessions_started: 0, sessions_completed: 0 };
  saveProfile(blank);
  return blank;
}

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16); window.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function emit(eventName, payload = {}) {
  state.sequence += 1;
  const now = performance.now();
  const t_ms = state.startedAt === null ? 0 : Math.max(0, Math.round(now - state.startedAt));
  const event = {
    schema_version: SCHEMA_VERSION,
    event: eventName,
    concept_id: state.concept.concept_id,
    build_id: BUILD_ID,
    session_id: state.sessionId,
    sequence: state.sequence,
    t_ms,
    payload,
  };
  state.events.push(event);
  renderValidation();
  renderLog();
  return event;
}

function startSession() {
  state.sessionId = uuid();
  state.sequence = 0;
  state.events = [];
  state.startedAt = performance.now();
  state.coreActions = 0;
  state.beats = [];
  state.completedSteps = [];
  state.finished = false;

  const profile = loadProfile(state.concept.concept_id);
  profile.sessions_started += 1;
  saveProfile(profile);

  emit('session_started', {
    role: state.concept.role,
    target_minutes: state.concept.target_minutes,
    profile: profile.recovered ? 'recovered' : (profile.sessions_started === 1 ? 'fresh' : 'reused'),
  });

  setStatus(`Session started. ${state.scenario ? 'Follow the scenario steps.' : 'Perform the core action 3 times.'}`);
  el('session-id').textContent = state.sessionId;
  renderBeats();
}

function coreAction() {
  if (!state.startedAt) startSession();
  if (state.scenario) {
    runCandidateStep('core_action');
    return;
  }
  state.coreActions += 1;
  emit('core_action_completed', {
    repetition: state.coreActions,
    action: state.concept.core_action,
  });
  if (state.coreActions >= 3) {
    setStatus(`Completed 3 core actions. Press Q to trigger signature reveal.`);
  } else {
    setStatus(`Core action ${state.coreActions}/3 completed. Press Space again.`);
  }
}

function signatureReveal() {
  if (!state.startedAt) return;
  if (state.scenario) {
    runCandidateStep('reveal');
    return;
  }
  if (state.coreActions < 3) {
    emit('invalid_action_blocked', { attempted: 'signature_reveal', reason: 'requires_3_core_actions' });
    setStatus(`Blocked: Perform the core action at least 3 times before reveal.`);
    return;
  }
  emit('signature_reveal_seen', { reveal: state.concept.signature_reveal });
  setStatus(`Reveal seen: ${state.concept.signature_reveal}. Press F to commit choice.`);
}

function commitChoice() {
  if (!state.startedAt) return;
  if (state.scenario) {
    runCandidateStep('choice');
    return;
  }
  emit('choice_committed', { choice: state.concept.choice, selected: 'default_decision' });
  setStatus(`Choice committed. Press Enter to complete scenario.`);
}

function advance() {
  if (!state.startedAt) {
    startSession();
    return;
  }
  if (state.finished) return;
  
  if (state.scenario) {
    const uncompleted = state.scenario.steps.filter(s => !state.completedSteps.includes(s.id));
    if (uncompleted.length > 0) {
      runCandidateStep(uncompleted[0].kind, uncompleted[0].id);
      return;
    }
  }

  emit('scenario_completed', { active_ms: Math.round(performance.now() - state.startedAt) });
  emit('next_hook_shown', { next_hook: state.concept.next_hook });
  emit('session_ended', {});
  state.finished = true;
  setStatus(`Scenario complete! Next: ${state.concept.next_hook}`);
}

function runCandidateStep(requestedKind = null, explicitStepId = null) {
  if (!state.startedAt) startSession();
  const scenario = state.scenario;
  if (!scenario) return;

  const targetStep = explicitStepId
    ? scenario.steps.find(s => s.id === explicitStepId)
    : scenario.steps.find(s => !state.completedSteps.includes(s.id) && (!requestedKind || s.kind === requestedKind));

  if (!targetStep) return;

  const blockedList = blockedSteps(scenario, state.completedSteps);
  const isBlocked = blockedList.find(b => b.id === targetStep.id);
  if (isBlocked) {
    emit('invalid_action_blocked', {
      attempted: targetStep.id,
      reason: 'prerequisites_not_met',
      missing: isBlocked.missing,
    });
    setStatus(`Blocked ${targetStep.label || targetStep.id}: missing prerequisites.`);
    return;
  }

  state.completedSteps.push(targetStep.id);
  state.current_step = targetStep;

  if (targetStep.kind === 'core_action') {
    state.coreActions += 1;
    emit('core_action_completed', {
      step_id: targetStep.id,
      label: targetStep.label,
      repetition: state.coreActions,
      transformation: targetStep.transformation,
    });
  } else if (targetStep.kind === 'reveal') {
    emit('signature_reveal_seen', {
      step_id: targetStep.id,
      label: targetStep.label,
      reveal: targetStep.description,
    });
  } else if (targetStep.kind === 'choice') {
    emit('choice_committed', {
      step_id: targetStep.id,
      label: targetStep.label,
      decision: 'archive',
    });
  } else if (targetStep.kind === 'inspect') {
    emit('inspect_performed', {
      step_id: targetStep.id,
      label: targetStep.label,
      subject: targetStep.id,
    });
  }

  setStatus(`${targetStep.label} complete.`);
  renderBeats();
}

function setStatus(text) {
  el('status').textContent = text;
}

function renderBeats() {
  const list = el('beats');
  if (!list) return;
  list.innerHTML = '';
  const steps = state.scenario ? state.scenario.steps : [];
  for (const s of steps) {
    const li = document.createElement('li');
    li.textContent = s.label || s.id;
    if (state.completedSteps.includes(s.id)) li.className = 'done';
    list.appendChild(li);
  }
}

function renderLog() {
  const logList = el('log-list');
  if (!logList) return;
  logList.innerHTML = '';
  const recent = state.events.slice(-5).reverse();
  for (const e of recent) {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.textContent = `[${e.event}] seq=${e.sequence} t=${e.t_ms}ms`;
    logList.appendChild(li);
  }
}

function renderValidation() {
  const v = validateSession(state.events);
  const valEl = el('state-val');
  if (valEl && state.startedAt) {
    valEl.textContent = v.ok ? 'TELEMETRY VALID' : 'TELEMETRY ERR';
  }
}

async function boot() {
  const res = await fetch('/bootstrap.json');
  const bootstrap = await res.json();
  state.concept = bootstrap.concept;
  state.identity = bootstrap.build_identity;
  state.scenario = bootstrap.scenario;
  BUILD_ID = bootstrap.build_identity.build_id;

  document.title = `${bootstrap.concept.title} - 2D Interactive MVP`;
  el('concept-title').textContent = bootstrap.concept.title;
  el('build-id').textContent = BUILD_ID;


  window.addEventListener('keydown', (ev) => {
    if (!state.startedAt) {
      if (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'KeyE') {
        startSession();
      }
    }

    if (ev.code === 'KeyE') {
      ev.preventDefault();
      runCandidateStep('inspect');
    } else if (ev.code === 'Space') {
      ev.preventDefault();
      runCandidateStep('core_action');
    } else if (ev.code === 'KeyQ') {
      ev.preventDefault();
      runCandidateStep('reveal');
    } else if (ev.code === 'KeyF') {
      ev.preventDefault();
      runCandidateStep('choice');
    } else if (ev.code === 'Enter') {
      ev.preventDefault();
      advance();
    } else if (ev.code === 'KeyR') {
      ev.preventDefault();
      resetProfile(state.concept.concept_id);
      location.reload();
    }
  });


  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    initCanvasRenderer(canvas, () => ({
      ...state,
      completed_step_ids: state.completedSteps,
    }), (verb) => {
      if (verb === 'core_action') coreAction();
    });
  }

  // Global window hook for testing and manual QA
  window.__scv = {
    getState: () => ({ ...state, completed_step_ids: state.completedSteps }),
    validate: () => validateSession(state.events),
    coreAction,
    advance,
    signatureReveal,
    commitChoice,
  };
}

boot();
