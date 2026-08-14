import createBlankGame from './canvas-renderer.js';
import { resolveInput, INPUT_MAP } from '/core/input.js';
import { validateSession, SCHEMA_VERSION } from '/core/telemetry.js';
import { blockedSteps, resolvePlayerAction, STEP_KINDS } from '/core/scenario-contract.js';

let BUILD_ID = null;
const PROFILE_KEY_PREFIX = 'scv.profile.';
const PROFILE_VERSION = 1;
const STATE_EVENT = 'scv:statechange';

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
  currentStep: null,
  finished: false,
  blankRevealSeen: false,
  blankChoiceCommitted: false,
  gameModule: null,
  gameLoadError: null,
};

let game = null;
let audio = null;
let gamepadFrameId = 0;
const previousGamepadButtons = new Map();

const dummyNode = {
  textContent: '', innerHTML: '', className: '', style: {},
  appendChild: () => {}, addEventListener: () => {}, querySelector: () => null,
};
const el = (id) => document.getElementById(id) || dummyNode;

function profileKey(conceptId) {
  return `${PROFILE_KEY_PREFIX}${conceptId}`;
}

function blankProfile(conceptId) {
  return {
    version: PROFILE_VERSION,
    concept_id: conceptId,
    sessions_started: 0,
    sessions_completed: 0,
  };
}

function saveProfile(profile) {
  try {
    const copy = { ...profile };
    delete copy.recovered;
    delete copy.recovery_reason;
    window.localStorage.setItem(profileKey(copy.concept_id), JSON.stringify(copy));
  } catch {
    // Persistence failure must never stop gameplay.
  }
}

function loadProfile(conceptId) {
  const blank = blankProfile(conceptId);
  let raw;
  try {
    raw = window.localStorage.getItem(profileKey(conceptId));
  } catch {
    return { ...blank, recovered: true, recovery_reason: 'storage_unavailable' };
  }
  if (!raw) return { ...blank, recovered: false, recovery_reason: null };

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

function resetStoredProfile(conceptId) {
  const blank = blankProfile(conceptId);
  saveProfile(blank);
  return blank;
}

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentPendingStep() {
  return state.scenario?.steps?.find((step) => !state.completedSteps.includes(step.id)) ?? null;
}

function publicState() {
  return {
    ...state,
    events: [...state.events],
    beats: [...state.beats],
    completedSteps: [...state.completedSteps],
    completed_step_ids: [...state.completedSteps],
    current_step: state.currentStep,
    pending_step: currentPendingStep(),
  };
}

function gameDebugState() {
  let candidate = null;
  try {
    candidate = game?.getDebugState?.() ?? null;
  } catch (err) {
    candidate = { error: `getDebugState failed: ${err.message}` };
  }
  return {
    module: state.gameModule,
    load_error: state.gameLoadError,
    candidate,
  };
}

function notifyStateChange(reason, detail = {}) {
  renderBeats();
  renderLog();
  renderValidation();
  renderHud();
  window.dispatchEvent(new CustomEvent(STATE_EVENT, {
    detail: {
      reason,
      ...detail,
      state: publicState(),
      game_state: gameDebugState(),
    },
  }));
}

function emit(eventName, payload = {}) {
  if (!state.sessionId || !BUILD_ID) return null;
  state.sequence += 1;
  const now = performance.now();
  const tMs = state.startedAt === null ? 0 : Math.max(0, Math.round(now - state.startedAt));
  const event = {
    schema_version: SCHEMA_VERSION,
    event: eventName,
    concept_id: state.concept.concept_id,
    build_id: BUILD_ID,
    session_id: state.sessionId,
    sequence: state.sequence,
    t_ms: tMs,
    payload,
  };
  state.events.push(event);
  return event;
}

function setStatus(text) {
  el('status').textContent = text;
}

function structured(ok, reason, missing = [], extra = {}) {
  return { ok, missing: [...missing], reason, ...extra };
}

function startSession() {
  if (state.startedAt && !state.finished) {
    return structured(true, 'already_started', [], { session_id: state.sessionId });
  }
  if (state.finished) {
    return structured(false, 'session_finished_reset_required');
  }

  state.sessionId = uuid();
  state.sequence = 0;
  state.events = [];
  state.startedAt = performance.now();
  state.coreActions = 0;
  state.beats = [];
  state.completedSteps = [];
  state.currentStep = null;
  state.finished = false;
  state.blankRevealSeen = false;
  state.blankChoiceCommitted = false;

  const profile = loadProfile(state.concept.concept_id);
  profile.sessions_started += 1;
  saveProfile(profile);

  emit('session_started', {
    role: state.concept.role,
    target_minutes: state.concept.target_minutes,
    profile: profile.recovered ? 'recovered' : (profile.sessions_started === 1 ? 'fresh' : 'returning'),
  });
  if (profile.recovered) emit('profile_recovered', { reason: profile.recovery_reason });

  state.beats.push('session_started');
  setStatus(`Session started. ${state.scenario ? 'Follow the scenario steps.' : 'Perform the core action at least 3 times.'}`);
  el('session-id').textContent = state.sessionId;
  notifyStateChange('session_started', { recovered: profile.recovered });
  return structured(true, 'started', [], { session_id: state.sessionId });
}

function eventPayloadForStep(step, payload) {
  const base = { ...payload, step_id: step.id, label: step.label ?? step.id };
  if (step.kind === 'core_action') {
    state.coreActions += 1;
    return {
      ...base,
      repetition: state.coreActions,
      action: state.concept.core_action,
      transformation_visible: Boolean(step.transformation),
    };
  }
  if (step.kind === 'reveal') {
    return { ...base, reveal: state.concept.signature_reveal };
  }
  if (step.kind === 'choice') {
    return {
      ...base,
      prompt: state.concept.choice,
      option: payload.option ?? step.default_option ?? 'default_decision',
      reversible: false,
      ...(step.evidence_object ? { evidence_object: step.evidence_object } : {}),
    };
  }
  return { ...base, subject: payload.subject ?? step.id };
}

function attemptStep(stepId, payload = {}) {
  if (!state.startedAt) return structured(false, 'session_not_started');
  if (state.finished) return structured(false, 'session_finished');
  if (!state.scenario) return structured(false, 'no_candidate_scenario');

  const step = state.scenario.steps.find((candidateStep) => candidateStep.id === stepId);
  if (!step) return structured(false, 'unknown_step', [], { step_id: stepId });

  if (state.completedSteps.includes(step.id)) {
    return structured(true, 'already_completed', [], { step_id: step.id, event: null });
  }

  const blocked = blockedSteps(state.scenario, state.completedSteps).find((entry) => entry.id === step.id);
  if (blocked) {
    emit('invalid_action_blocked', {
      attempted: step.id,
      reason: 'prerequisites_not_met',
      missing: blocked.missing,
      ...(payload.source ? { source: payload.source } : {}),
    });
    setStatus(`Blocked ${step.label ?? step.id}: missing ${blocked.missing.join(', ')}.`);
    notifyStateChange('step_blocked', { step_id: step.id, missing: blocked.missing });
    return structured(false, 'prerequisites_not_met', blocked.missing, { step_id: step.id });
  }

  const eventName = STEP_KINDS[step.kind];
  if (!eventName) return structured(false, 'unsupported_step_kind', [], { step_id: step.id });

  const event = emit(eventName, eventPayloadForStep(step, payload));
  state.completedSteps.push(step.id);
  state.currentStep = step;
  state.beats.push(step.id);
  setStatus(`${step.label ?? step.id} complete.`);
  notifyStateChange('step_completed', { step_id: step.id, event: eventName });
  return structured(true, 'completed', [], { step_id: step.id, event });
}

function blankCoreAction(payload = {}) {
  if (!state.startedAt) startSession();
  if (state.finished) return structured(false, 'session_finished');
  state.coreActions += 1;
  const event = emit('core_action_completed', {
    ...payload,
    repetition: state.coreActions,
    action: state.concept.core_action,
    transformation_visible: false,
  });
  setStatus(state.coreActions >= 3
    ? 'Core action threshold met. Press Q for the reveal.'
    : `Core action ${state.coreActions}/3 completed.`);
  notifyStateChange('blank_core_action', { repetition: state.coreActions });
  return structured(true, 'completed', [], { event });
}

function blankReveal(payload = {}) {
  if (!state.startedAt) return structured(false, 'session_not_started');
  if (state.blankRevealSeen) return structured(true, 'already_completed');
  if (state.coreActions < 3) {
    const missing = ['core_action_3'];
    emit('invalid_action_blocked', {
      attempted: 'signature_reveal_seen',
      reason: 'core_action_min_not_met',
      missing,
    });
    setStatus('Blocked: perform the core action at least three times first.');
    notifyStateChange('blank_reveal_blocked', { missing });
    return structured(false, 'core_action_min_not_met', missing);
  }
  state.blankRevealSeen = true;
  const event = emit('signature_reveal_seen', { ...payload, reveal: state.concept.signature_reveal });
  setStatus('Reveal complete. Press F to commit the choice.');
  notifyStateChange('blank_reveal');
  return structured(true, 'completed', [], { event });
}

function blankChoice(payload = {}) {
  if (!state.startedAt) return structured(false, 'session_not_started');
  if (state.blankChoiceCommitted) return structured(true, 'already_completed');
  if (!state.blankRevealSeen) {
    const missing = ['signature_reveal_seen'];
    emit('invalid_action_blocked', {
      attempted: 'choice_committed',
      reason: 'reveal_not_seen',
      missing,
    });
    setStatus('Blocked: trigger the reveal before committing a choice.');
    notifyStateChange('blank_choice_blocked', { missing });
    return structured(false, 'reveal_not_seen', missing);
  }
  state.blankChoiceCommitted = true;
  const event = emit('choice_committed', {
    ...payload,
    prompt: state.concept.choice,
    option: payload.option ?? 'default_decision',
    reversible: false,
  });
  setStatus('Choice committed. Press Enter to complete the scenario.');
  notifyStateChange('blank_choice');
  return structured(true, 'completed', [], { event });
}

function completeScenario(payload = {}) {
  if (!state.startedAt) return structured(false, 'session_not_started');
  if (state.finished) return structured(true, 'already_completed');

  let missing = [];
  if (state.scenario) {
    missing = state.scenario.steps
      .filter((step) => !state.completedSteps.includes(step.id))
      .map((step) => step.id);
  } else {
    if (state.coreActions < 3) missing.push('core_action_3');
    if (!state.blankRevealSeen) missing.push('signature_reveal_seen');
    if (!state.blankChoiceCommitted) missing.push('choice_committed');
  }

  if (missing.length > 0) {
    emit('invalid_action_blocked', {
      attempted: 'scenario_completed',
      reason: 'requirements_incomplete',
      missing,
    });
    setStatus(`Blocked: ${missing.join(', ')} still pending.`);
    notifyStateChange('scenario_blocked', { missing });
    return structured(false, 'requirements_incomplete', missing);
  }

  const activeMs = Math.max(0, Math.round(performance.now() - state.startedAt));
  emit('scenario_completed', {
    ...payload,
    core_actions: state.coreActions,
    unassisted: true,
    active_ms: activeMs,
  });
  emit('next_hook_shown', { hook: state.concept.next_hook });
  emit('session_ended', { reason: 'scenario_completed', active_ms: activeMs });
  state.beats.push('scenario_completed', 'session_ended');
  state.finished = true;

  const profile = loadProfile(state.concept.concept_id);
  profile.sessions_completed += 1;
  saveProfile(profile);

  setStatus(`Scenario complete! Next: ${state.concept.next_hook}`);
  notifyStateChange('scenario_completed');
  return structured(true, 'completed');
}

function resetProfileAction() {
  resetStoredProfile(state.concept.concept_id);
  state.sessionId = null;
  state.events = [];
  state.sequence = 0;
  state.startedAt = null;
  state.coreActions = 0;
  state.beats = [];
  state.completedSteps = [];
  state.currentStep = null;
  state.finished = false;
  state.blankRevealSeen = false;
  state.blankChoiceCommitted = false;
  setStatus('Profile reset to a clean state. Press Enter to start a fresh session.');
  notifyStateChange('profile_reset');
  return structured(true, 'reset');
}

const actions = Object.freeze({
  startSession,
  attemptStep,
  completeScenario,
  resetProfile: resetProfileAction,
});

function createAudioService() {
  let context = null;
  let muted = false;
  let unavailable = false;

  function getContext() {
    if (muted || unavailable) return null;
    try {
      if (!context) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) {
          unavailable = true;
          return null;
        }
        context = new AudioCtor();
      }
      if (context.state === 'suspended') void context.resume().catch(() => {});
      return context;
    } catch {
      unavailable = true;
      return null;
    }
  }

  function tone({ frequency = 440, type = 'sine', duration = 0.12, gain = 0.05, detune = 0 } = {}) {
    const ctx = getContext();
    if (!ctx) return false;
    try {
      const oscillator = ctx.createOscillator();
      const amp = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      oscillator.detune.setValueAtTime(detune, ctx.currentTime);
      amp.gain.setValueAtTime(Math.max(0, gain), ctx.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      oscillator.connect(amp);
      amp.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
      return true;
    } catch {
      return false;
    }
  }

  function noise({ duration = 0.08, gain = 0.03, filterFrequency = 1800 } = {}) {
    const ctx = getContext();
    if (!ctx) return false;
    try {
      const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const amp = ctx.createGain();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(filterFrequency, ctx.currentTime);
      amp.gain.setValueAtTime(Math.max(0, gain), ctx.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      source.connect(filter);
      filter.connect(amp);
      amp.connect(ctx.destination);
      source.start();
      source.stop(ctx.currentTime + duration);
      return true;
    } catch {
      return false;
    }
  }

  return {
    get muted() { return muted; },
    get available() { return !unavailable; },
    setMuted(value) {
      muted = Boolean(value);
      return muted;
    },
    toggleMuted() {
      muted = !muted;
      return muted;
    },
    tone,
    noise,
    destroy() {
      if (context) void context.close().catch(() => {});
      context = null;
    },
  };
}

function toCanvasPoint(event) {
  const canvas = el('game-canvas');
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return {
    x,
    y,
    scaleX,
    scaleY,
    inside: x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height,
  };
}

function isHandled(value) {
  return value === true || (value && typeof value === 'object' && value.handled === true);
}

function firstPendingKind(kind) {
  return state.scenario?.steps?.find(
    (step) => step.kind === kind && !state.completedSteps.includes(step.id),
  ) ?? null;
}

async function genericVerbFallback(verb, meta = {}) {
  if (verb === 'reset_profile') return resetProfileAction();
  if (verb === 'advance') return state.startedAt ? completeScenario({ source: meta.source }) : startSession();

  if (!state.startedAt) startSession();
  if (state.finished) return structured(false, 'session_finished');

  if (!state.scenario) {
    if (verb === 'core_action') return blankCoreAction({ source: meta.source });
    if (verb === 'inspect') return blankReveal({ source: meta.source });
    if (verb === 'commit_choice') return blankChoice({ source: meta.source });
    if (verb === 'interact') {
      const event = emit('inspect_performed', { subject: 'scenario_objective', source: meta.source });
      notifyStateChange('blank_inspect');
      return structured(true, 'completed', [], { event });
    }
    return structured(false, 'no_generic_fallback');
  }

  const kind = verb === 'core_action' ? 'core_action'
    : verb === 'inspect' ? 'reveal'
      : verb === 'commit_choice' ? 'choice'
        : verb === 'interact' ? 'inspect'
          : null;
  if (!kind) return structured(false, 'no_generic_fallback');
  const step = firstPendingKind(kind);
  if (!step) return structured(false, 'no_pending_step');
  return attemptStep(step.id, { source: meta.source, raw_input: meta.rawInput });
}

async function routeRawInput(rawInput, source = 'keyboard') {
  const playerAction = resolvePlayerAction(state.scenario, rawInput);
  if (playerAction) {
    const candidateResult = await Promise.resolve(
      game?.handlePlayerAction?.(playerAction, { rawInput, source }),
    );
    if (isHandled(candidateResult)) {
      notifyStateChange('candidate_player_action', { action_id: playerAction.id, source });
      return candidateResult;
    }
    if (!state.startedAt) startSession();
    return attemptStep(playerAction.step_id, {
      source,
      raw_input: rawInput,
      action_id: playerAction.id,
    });
  }

  const verb = resolveInput(rawInput);
  if (!verb) return structured(false, 'unbound_input');

  const candidateResult = await Promise.resolve(game?.handleVerb?.(verb, { rawInput, source }));
  if (isHandled(candidateResult)) {
    notifyStateChange('candidate_verb', { verb, source });
    return candidateResult;
  }
  return genericVerbFallback(verb, { rawInput, source });
}

const GAMEPAD_BUTTON_NAMES = Object.freeze({
  0: 'BUTTON_A',
  1: 'BUTTON_B',
  2: 'BUTTON_X',
  3: 'BUTTON_Y',
  8: 'BUTTON_SELECT',
  9: 'BUTTON_START',
});

function pollGamepads() {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    for (const [indexText, rawInput] of Object.entries(GAMEPAD_BUTTON_NAMES)) {
      const index = Number(indexText);
      const key = `${pad.index}:${index}`;
      const pressed = Boolean(pad.buttons[index]?.pressed);
      const wasPressed = previousGamepadButtons.get(key) ?? false;
      previousGamepadButtons.set(key, pressed);
      if (pressed && !wasPressed) void routeRawInput(rawInput, 'gamepad');
    }
  }
  gamepadFrameId = requestAnimationFrame(pollGamepads);
}

function renderBeats() {
  const list = el('beats');
  list.innerHTML = '';
  for (const step of state.scenario?.steps ?? []) {
    const li = document.createElement('li');
    li.textContent = step.label ?? step.id;
    if (state.completedSteps.includes(step.id)) li.className = 'done';
    list.appendChild(li);
  }
}

function renderLog() {
  const recent = state.events.slice(-5).reverse();
  const logList = el('log-list');
  logList.innerHTML = '';
  for (const event of recent) {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.textContent = `[${event.event}] seq=${event.sequence} t=${event.t_ms}ms`;
    logList.appendChild(li);
  }
  el('log').textContent = state.events.length
    ? state.events.map((event) => `${event.sequence} ${event.t_ms}ms ${event.event}`).join('\n')
    : 'no events yet';
}

function renderValidation() {
  if (!state.startedAt || state.events.length === 0) return;
  const validation = validateSession(state.events);
  el('state-val').textContent = state.finished
    ? (validation.ok ? 'COMPLETE / VALID' : 'COMPLETE / INVALID')
    : 'ACTIVE';
}

function renderHud() {
  const total = state.scenario?.steps?.length ?? 0;
  const progress = total > 0 ? Math.round((state.completedSteps.length / total) * 100) : 0;
  el('progress-val').textContent = `${progress}%`;
  if (!state.startedAt) el('state-val').textContent = 'READY';
  if (state.startedAt) {
    const seconds = Math.max(0, Math.floor((performance.now() - state.startedAt) / 1000));
    el('time-val').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  } else {
    el('time-val').textContent = '00:00';
  }
}

function renderControls() {
  const list = el('controls');
  list.innerHTML = '';
  for (const [verb, binding] of Object.entries(INPUT_MAP)) {
    const li = document.createElement('li');
    li.textContent = `${binding.keyboard.join(' / ')} — ${binding.label} (${verb})`;
    list.appendChild(li);
  }
  for (const action of state.scenario?.player_actions ?? []) {
    const li = document.createElement('li');
    li.textContent = `${action.keyboard.join(' / ')} — ${action.label ?? action.step_id}`;
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
    game_state: gameDebugState(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${state.concept.concept_id}.session.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function validateGameLifecycle(instance) {
  if (!instance || typeof instance !== 'object') throw new Error('createGame() must return an object');
  for (const name of ['handleVerb', 'handlePlayerAction', 'destroy', 'getDebugState']) {
    if (typeof instance[name] !== 'function') throw new Error(`createGame() result must implement ${name}()`);
  }
  return instance;
}

async function createCandidateGame(bootstrap) {
  const canvas = el('game-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = el('canvas-overlay');
  const debug = Object.freeze({
    log: (...args) => console.debug('[candidate-game]', ...args),
    stateChanged: (reason = 'candidate_state', detail = {}) => notifyStateChange(reason, detail),
  });
  const lifecycleArgs = {
    canvas,
    ctx,
    overlay,
    concept: state.concept,
    scenario: state.scenario,
    getState: publicState,
    actions,
    audio,
    toCanvasPoint,
    debug,
  };

  if (!bootstrap.game_module) {
    state.gameModule = null;
    return validateGameLifecycle(createBlankGame(lifecycleArgs));
  }

  state.gameModule = bootstrap.game_module;
  try {
    const module = await import(bootstrap.game_module);
    if (typeof module.default !== 'function') throw new Error('candidate game module must default-export createGame()');
    return validateGameLifecycle(await Promise.resolve(module.default(lifecycleArgs)));
  } catch (err) {
    state.gameLoadError = err.message;
    setStatus(`Candidate game module failed to load; using neutral fallback: ${err.message}`);
    return validateGameLifecycle(createBlankGame(lifecycleArgs));
  }
}

async function boot() {
  const response = await fetch('/bootstrap.json');
  const bootstrap = await response.json();
  state.concept = bootstrap.concept;
  state.identity = bootstrap.build_identity;
  state.scenario = bootstrap.scenario;
  BUILD_ID = bootstrap.build_identity.build_id;
  audio = createAudioService();

  document.title = `${bootstrap.concept.title} - modular Canvas host`;
  el('concept-title').textContent = bootstrap.concept.title;
  el('build-id').textContent = BUILD_ID;
  el('concept-role').textContent = bootstrap.concept.role;
  el('concept-core-action').textContent = bootstrap.concept.core_action;
  el('concept-reveal').textContent = bootstrap.concept.signature_reveal;
  el('concept-choice').textContent = bootstrap.concept.choice;
  el('concept-hook').textContent = bootstrap.concept.next_hook;
  el('concept-target').textContent = `${bootstrap.concept.target_minutes.min}-${bootstrap.concept.target_minutes.max} minutes`;
  el('shell-hint').textContent = bootstrap.game_module
    ? `Candidate game module: ${bootstrap.game_module}`
    : 'No candidate game.js; neutral blank-shell renderer active.';

  const canvas = el('game-canvas');
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (event) => {
    try { canvas.setPointerCapture(event.pointerId); } catch { /* capture unsupported */ }
  });
  const releasePointer = (event) => {
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch { /* capture unsupported */ }
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  renderControls();
  renderBeats();
  renderLog();
  renderHud();

  game = await createCandidateGame(bootstrap);

  window.addEventListener('keydown', (event) => {
    const playerAction = resolvePlayerAction(state.scenario, event.code);
    const verb = resolveInput(event.code);
    if (!playerAction && !verb) return;
    event.preventDefault();
    void routeRawInput(event.code, 'keyboard');
  });

  el('export-btn').addEventListener('click', exportSession);
  el('reset-btn').addEventListener('click', resetProfileAction);
  el('audio-toggle-btn').addEventListener('click', () => {
    const muted = audio.toggleMuted();
    el('audio-toggle-btn').textContent = muted ? 'UNMUTE AUDIO' : 'MUTE AUDIO';
    notifyStateChange('audio_mute_changed', { muted });
  });

  gamepadFrameId = requestAnimationFrame(pollGamepads);

  window.__scv = {
    getState: publicState,
    getGameState: gameDebugState,
    validate: () => validateSession(state.events),
    actions,
    coreAction: () => genericVerbFallback('core_action', { source: 'test_hook' }),
    signatureReveal: () => genericVerbFallback('inspect', { source: 'test_hook' }),
    commitChoice: () => genericVerbFallback('commit_choice', { source: 'test_hook' }),
    advance: () => genericVerbFallback('advance', { source: 'test_hook' }),
    dispatchRawInput: routeRawInput,
  };

  notifyStateChange('boot_complete', { game_module: bootstrap.game_module });
}

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(gamepadFrameId);
  try { game?.destroy?.(); } catch { /* ignore teardown failures */ }
  audio?.destroy?.();
});

boot().catch((err) => {
  state.gameLoadError = err.message;
  setStatus(`Shell boot failed: ${err.message}`);
  console.error(err);
});
