const COLORS = Object.freeze({
  bg: '#0f1115', wood: '#4a3426', wood2: '#2e2119', brass: '#c9943b', brassHi: '#f3d17a',
  cream: '#e8ddbf', ink: '#171513', cyan: '#78dce8', cold: '#9bc9ff', rust: '#a94d2f',
  green: '#78c091', red: '#e46d67', violet: '#8b70cf', gold: '#e3b341', paper: '#d7c8a6',
  panel: 'rgba(9,13,18,.96)', white: '#f2f5f7', muted: '#9aa8b1', black: '#050607',
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const dist2 = (a, b) => { const x = a.x - b.x; const y = a.y - b.y; return x * x + y * y; };

function roundedRect(ctx, x, y, w, h, r = 12) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y); ctx.lineTo(x + w - q, y); ctx.quadraticCurveTo(x + w, y, x + w, y + q);
  ctx.lineTo(x + w, y + h - q); ctx.quadraticCurveTo(x + w, y + h, x + w - q, y + h);
  ctx.lineTo(x + q, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - q);
  ctx.lineTo(x, y + q); ctx.quadraticCurveTo(x, y, x + q, y); ctx.closePath();
}

function makePanel(title, body, label = title) {
  const node = document.createElement('section');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'false');
  node.setAttribute('aria-label', label);
  node.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,calc(100% - 48px));padding:20px;border:1px solid rgba(120,220,232,.62);border-radius:14px;background:rgba(9,13,18,.96);box-shadow:0 20px 70px #000b;color:#f2f5f7;font-family:system-ui,sans-serif;pointer-events:auto;z-index:30';
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'margin:0 0 8px;color:#78dce8;font-size:21px';
  const paragraph = document.createElement('p');
  paragraph.textContent = body;
  paragraph.style.cssText = 'margin:0 0 14px;color:#c6d0d6;line-height:1.5';
  node.append(heading, paragraph);
  return { node, heading, paragraph };
}

function makeButton(label, accent = COLORS.cyan) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = `border:1px solid ${accent};border-radius:8px;background:#ffffff10;color:#fff;padding:10px 13px;font:700 13px system-ui,sans-serif;cursor:pointer`;
  return button;
}

function occupancyGrid(cx, cy, radius, step = 12) {
  const cells = [];
  for (let y = cy - radius; y <= cy + radius; y += step) {
    for (let x = cx - radius; x <= cx + radius; x += step) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) cells.push({ x, y, done: false });
    }
  }
  return { cells, done: 0, total: Math.max(1, cells.length) };
}

function samplePolyline(points, count = 42) {
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ a, b, length, start: total }); total += length;
  }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = total * (i / Math.max(1, count - 1));
    const seg = segments.find((s) => d <= s.start + s.length) ?? segments.at(-1);
    const t = seg.length ? (d - seg.start) / seg.length : 0;
    out.push({ x: lerp(seg.a.x, seg.b.x, t), y: lerp(seg.a.y, seg.b.y, t), done: false });
  }
  return out;
}

export default function createGame({
  canvas, ctx, overlay, concept, scenario, getState, actions, audio, toCanvasPoint, debug,
}) {
  if (!canvas || !ctx || !overlay || !scenario) {
    throw new Error('cursed_secondhand game requires canvas, ctx, overlay, and scenario');
  }

  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;
  const clock = { x: W * 0.50, y: H * 0.42, caseW: 270, caseH: 365, dialR: 92 };
  const dial = { x: clock.x, y: clock.y - 48, r: clock.dialR };
  const tray = { x: W * 0.68, y: H * 0.70, w: 190, h: 88 };
  const joint = { x: clock.x + 70, y: clock.y + 55 };
  const portalRect = { x: clock.x - 120, y: 72, w: 240, h: 250 };

  const overlayOld = {
    inset: overlay.style.inset,
    bottom: overlay.style.bottom,
    display: overlay.style.display,
    pointerEvents: overlay.style.pointerEvents,
  };
  overlay.style.inset = '0';
  overlay.style.bottom = '0';
  overlay.style.display = 'block';
  overlay.style.pointerEvents = 'none';

  const ledger = makePanel(
    'INTAKE LEDGER // 0417',
    'Brass pendulum wall clock. Intake time 4:17. Movement seized; pendulum still swinging. No claimant paperwork. Diagnose before using tools.',
    'Intake 0417 ledger',
  );
  const ledgerButton = makeButton('BEGIN INTAKE (E)', COLORS.gold);
  ledger.node.append(ledgerButton);
  overlay.append(ledger.node);

  const dispositionPanel = makePanel(
    'STAMP INTAKE 0417',
    'The portal has closed and the restored clock is back on the bench. Stamp the intake docket with one real disposition.',
    'Clock disposition ledger',
  );
  dispositionPanel.node.hidden = true;
  const dispositionRow = document.createElement('div');
  dispositionRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px';
  for (const option of scenario.steps.find((step) => step.id === 'disposition')?.options ?? []) {
    const button = makeButton(option.label, option.id === 'archive' ? COLORS.gold : COLORS.cyan);
    button.setAttribute('aria-label', `${option.label}: ${option.consequence}`);
    button.onclick = (event) => { event.stopPropagation(); commitDisposition(option.id); };
    dispositionRow.append(button);
  }
  dispositionPanel.node.append(dispositionRow);
  overlay.append(dispositionPanel.node);

  const hotspots = [
    { id: 'dust', label: 'DUST // 4-5 ARC', x: dial.x - 58, y: dial.y + 14, r: 34, inspected: false },
    { id: 'damage', label: 'CRACK // STRIKE LEVER', x: joint.x, y: joint.y, r: 31, inspected: false },
    { id: 'curse', label: 'COLD RESIDUE', x: dial.x + 65, y: dial.y - 32, r: 31, inspected: false },
  ];

  const dustGrid = occupancyGrid(dial.x, dial.y, dial.r - 12, 12);
  const crackPolyline = [
    { x: joint.x - 54, y: joint.y + 20 },
    { x: joint.x - 26, y: joint.y - 8 },
    { x: joint.x + 2, y: joint.y + 10 },
    { x: joint.x + 27, y: joint.y - 18 },
    { x: joint.x + 52, y: joint.y + 4 },
  ];
  const solderSamples = samplePolyline(crackPolyline, 44);
  const residue = Array.from({ length: 18 }, (_, i) => ({
    id: `residue_${i + 1}`,
    x: dial.x + 60 + Math.cos(i * 1.31) * (24 + (i % 4) * 7),
    y: dial.y - 18 + Math.sin(i * 1.17) * (36 + (i % 3) * 7),
    picked: false,
    deposited: false,
  }));

  let destroyed = false;
  let frameId = 0;
  let activePointer = null;
  let dragMode = null;
  let lastPoint = null;
  let brushCoverage = 0;
  let dustSent = false;
  let solderHeat = 0;
  let solderSent = false;
  let residueLoaded = [];
  let traceSent = false;
  let portalStartedAt = 0;
  let portalProgress = 0;
  let portalSent = false;
  let selectedDisposition = null;
  let message = '';
  let messageUntil = 0;
  let lastTickAt = 0;
  let lastBrushSound = 0;
  let lastSolderSound = 0;
  let lastSaltSound = 0;
  const keyboardProgress = Object.create(null);

  const state = () => getState();
  const pending = () => state().pending_step?.id ?? null;
  const done = (id) => state().completedSteps?.includes(id) ?? false;

  function phase() {
    const s = state();
    if (!s.startedAt) return 'ledger';
    const id = s.pending_step?.id;
    if (id) return id;
    if (s.scenario && s.completedSteps.length === s.scenario.steps.length) return s.finished ? 'complete' : 'ready_complete';
    return 'idle';
  }

  function flash(text, ms = 1600) {
    message = text;
    messageUntil = performance.now() + ms;
    debug.stateChanged('cursed_secondhand_feedback', { message: text });
  }

  function reject(text) {
    flash(text, 1900);
    audio.tone({ frequency: 145, type: 'square', duration: 0.11, gain: 0.035 });
  }

  function accept(text) {
    flash(text, 1250);
    audio.tone({ frequency: 620, type: 'sine', duration: 0.11, gain: 0.03 });
  }

  function attempt(id, payload = {}) {
    const result = actions.attemptStep(id, { ...payload, source: payload.source ?? 'cursed_secondhand_game' });
    if (!result.ok) {
      reject(result.missing?.length ? `${id} blocked: missing ${result.missing.join(', ')}` : `${id} blocked: ${result.reason}`);
    } else if (result.reason === 'completed') {
      accept(`${id} complete`);
    }
    return result;
  }

  function beginLedger() {
    if (!state().startedAt) actions.startSession();
    ledger.node.hidden = true;
    flash('INTAKE 0417 OPEN // inspect all three visible readings');
    debug.stateChanged('cursed_secondhand_intake_open', { intake_id: scenario.item?.intake_id ?? 'INTAKE-0417' });
    return true;
  }
  ledgerButton.onclick = (event) => { event.stopPropagation(); beginLedger(); };

  function inspectHotspot(hotspot) {
    if (pending() !== 'diagnose' || hotspot.inspected) return false;
    hotspot.inspected = true;
    audio.tone({ frequency: hotspot.id === 'curse' ? 360 : 520, type: hotspot.id === 'curse' ? 'triangle' : 'sine', duration: 0.10, gain: 0.025 });
    flash(`${hotspot.label} // reading logged`);
    debug.stateChanged('cursed_secondhand_hotspot', { hotspot: hotspot.id, inspected: true });
    if (hotspots.every((entry) => entry.inspected)) {
      attempt('diagnose', { traces: hotspots.map((entry) => entry.id) });
    }
    return true;
  }

  function dustCoverage() { return dustGrid.done / dustGrid.total; }
  function brushAt(point, radius = 24, sound = true) {
    if (pending() !== 'dust_pass') return false;
    let added = 0;
    const r2 = radius * radius;
    for (const cell of dustGrid.cells) {
      if (!cell.done && dist2(point, cell) <= r2) { cell.done = true; dustGrid.done += 1; added += 1; }
    }
    brushCoverage = dustCoverage();
    if (added) {
      const now = performance.now();
      if (sound && now - lastBrushSound > 80) {
        audio.noise({ duration: 0.045, gain: 0.014, filterFrequency: 2100 });
        lastBrushSound = now;
      }
      debug.stateChanged('cursed_secondhand_brush', { coverage: brushCoverage });
    }
    if (!dustSent && brushCoverage >= 0.72) {
      dustSent = true;
      const result = attempt('dust_pass', { tool: 'soft_brush', unique_coverage: Number(brushCoverage.toFixed(4)) });
      if (!result.ok) dustSent = false;
    }
    return added > 0;
  }

  function visitSolder(point) {
    if (pending() !== 'solder_pass') return 0;
    let added = 0;
    let onJoint = false;
    for (const sample of solderSamples) {
      if (dist2(point, sample) <= 23 ** 2) {
        onJoint = true;
        if (!sample.done) { sample.done = true; added += 1; }
      }
    }
    if (onJoint) {
      // Coverage is unique, but heat is physical contact: revisiting an already
      // soldered section can reheat the joint instead of creating a soft-lock.
      solderHeat = clamp(solderHeat + 0.010 + added * 0.014, 0, 1);
      const now = performance.now();
      if (now - lastSolderSound > 95) {
        audio.tone({ frequency: 185 + solderHeat * 80, type: 'sawtooth', duration: 0.07, gain: 0.025 });
        lastSolderSound = now;
      }
      debug.stateChanged('cursed_secondhand_solder', {
        coverage: solderSamples.filter((sample) => sample.done).length / solderSamples.length,
        heat: solderHeat,
      });
    }
    maybeFinishSolder();
    return added;
  }

  function maybeFinishSolder() {
    if (solderSent || pending() !== 'solder_pass') return;
    const coverage = solderSamples.filter((sample) => sample.done).length / solderSamples.length;
    if (coverage >= 0.84 && solderHeat >= 0.62) {
      solderSent = true;
      const result = attempt('solder_pass', {
        tool: 'solder_iron', joint_coverage: Number(coverage.toFixed(4)), heat: Number(solderHeat.toFixed(3)),
      });
      if (!result.ok) solderSent = false;
    }
  }

  function collectResidue(point) {
    if (pending() !== 'trace_pass') return 0;
    let added = 0;
    for (const mote of residue) {
      if (!mote.picked && !mote.deposited && dist2(point, mote) <= 24 ** 2) {
        mote.picked = true;
        residueLoaded.push(mote);
        added += 1;
      }
    }
    if (added) {
      const now = performance.now();
      if (now - lastSaltSound > 85) {
        audio.noise({ duration: 0.06, gain: 0.018, filterFrequency: 3100 });
        lastSaltSound = now;
      }
      debug.stateChanged('cursed_secondhand_trace_pickup', {
        loaded: residueLoaded.length,
        deposited: residue.filter((mote) => mote.deposited).length,
      });
    }
    return added;
  }

  function depositResidue(point) {
    if (!residueLoaded.length) return false;
    if (!inside(point, tray)) {
      for (const mote of residueLoaded) mote.picked = false;
      residueLoaded = [];
      reject('TRACE REJECTED // carry the drawn-off residue into the brass tray');
      return false;
    }
    for (const mote of residueLoaded) { mote.picked = false; mote.deposited = true; }
    residueLoaded = [];
    audio.noise({ duration: 0.11, gain: 0.025, filterFrequency: 3700 });
    accept('COLD TRACE // deposited into tray');
    const deposited = residue.filter((mote) => mote.deposited).length;
    debug.stateChanged('cursed_secondhand_trace_deposit', { deposited, total: residue.length });
    if (!traceSent && deposited === residue.length) {
      traceSent = true;
      const result = attempt('trace_pass', { tool: 'trace_salt', residue_motes: deposited, tray: 'brass_trace_tray' });
      if (!result.ok) traceSent = false;
    }
    return true;
  }

  function inspectMemory() {
    if (pending() !== 'memory_clue') return false;
    const result = attempt('memory_clue', { personal_memory: true, observed_shape: 'hand_stopping_clock_at_4_17' });
    if (result.ok) {
      audio.tone({ frequency: 417, type: 'triangle', duration: 0.24, gain: 0.035 });
      flash('MEMORY SHAPE // owner stopped the clock by hand at 4:17');
    }
    return result.ok;
  }

  function startPortal() {
    if (pending() !== 'interior_reveal') return false;
    if (portalStartedAt) return true;
    portalStartedAt = performance.now();
    portalProgress = 0;
    portalSent = false;
    audio.tone({ frequency: 220, type: 'sine', duration: 0.55, gain: 0.04 });
    audio.tone({ frequency: 330, type: 'triangle', duration: 0.48, gain: 0.026, detune: 7 });
    audio.tone({ frequency: 417, type: 'sine', duration: 0.62, gain: 0.022, detune: -5 });
    debug.stateChanged('cursed_secondhand_portal_started', { time: '4:17' });
    return true;
  }

  function finishPortalIfReady(time) {
    if (!portalStartedAt || portalSent || pending() !== 'interior_reveal') return;
    portalProgress = clamp((time - portalStartedAt) / 4200, 0, 1);
    if (portalProgress < 1) return;
    portalSent = true;
    const result = attempt('interior_reveal', {
      interior_space: true, reversible: true, visible_pendulum_sweep: true, portal_closed_before_completion: true,
    });
    if (!result.ok) portalSent = false;
    else {
      portalStartedAt = 0;
      portalProgress = 0;
      flash('PORTAL CLOSED // workshop restored exactly as before');
    }
  }

  function commitDisposition(option) {
    if (pending() !== 'disposition') return false;
    const result = attempt('disposition', { option, stamped_option: option, source: 'ledger_stamp' });
    if (!result.ok) return false;
    selectedDisposition = option;
    dispositionPanel.node.hidden = true;
    audio.noise({ duration: 0.09, gain: 0.045, filterFrequency: 620 });
    audio.tone({ frequency: 110, type: 'square', duration: 0.09, gain: 0.035 });
    debug.stateChanged('cursed_secondhand_disposition_stamp', { option });
    return true;
  }

  function interpolateStroke(a, b, spacing, fn) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.ceil(distance / spacing));
    for (let i = 1; i <= count; i += 1) {
      const t = i / count;
      fn({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    }
  }

  function pointerDown(event) {
    if (destroyed || activePointer !== null) return;
    const point = toCanvasPoint(event);
    if (!point.inside) return;
    activePointer = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* host/browser may already own capture */ }

    if (phase() === 'diagnose') {
      const hotspot = hotspots.find((entry) => dist2(point, entry) <= entry.r ** 2);
      if (hotspot) inspectHotspot(hotspot);
      return;
    }
    if (phase() === 'dust_pass') { dragMode = 'brush'; lastPoint = point; brushAt(point); return; }
    if (phase() === 'solder_pass') { dragMode = 'solder'; lastPoint = point; visitSolder(point); return; }
    if (phase() === 'trace_pass') { dragMode = 'trace'; lastPoint = point; collectResidue(point); return; }
    if (phase() === 'memory_clue' && inside(point, tray)) inspectMemory();
  }

  function pointerMove(event) {
    if (event.pointerId !== activePointer || !dragMode) return;
    const point = toCanvasPoint(event);
    if (!lastPoint) lastPoint = point;
    if (dragMode === 'brush') interpolateStroke(lastPoint, point, 7, (p) => brushAt(p));
    else if (dragMode === 'solder') interpolateStroke(lastPoint, point, 6, visitSolder);
    else if (dragMode === 'trace') interpolateStroke(lastPoint, point, 7, collectResidue);
    lastPoint = point;
  }

  function pointerUp(event) {
    if (event.pointerId !== activePointer) return;
    const point = toCanvasPoint(event);
    try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    if (dragMode === 'trace') depositResidue(point);
    activePointer = null;
    dragMode = null;
    lastPoint = null;
  }

  function pointerCancel(event) {
    if (event.pointerId !== activePointer) return;
    if (dragMode === 'trace' && residueLoaded.length) {
      for (const mote of residueLoaded) mote.picked = false;
      residueLoaded = [];
    }
    activePointer = null;
    dragMode = null;
    lastPoint = null;
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);

  function keyboardCore() {
    const id = pending();
    keyboardProgress[id] = (keyboardProgress[id] ?? 0) + 1;
    if (id === 'dust_pass') {
      const remaining = dustGrid.cells.filter((cell) => !cell.done);
      const n = Math.ceil(dustGrid.total * 0.26);
      for (const cell of remaining.slice(0, n)) brushAt(cell, 8, false);
      audio.noise({ duration: 0.07, gain: 0.014, filterFrequency: 2050 });
      return true;
    }
    if (id === 'solder_pass') {
      const remaining = solderSamples.filter((sample) => !sample.done);
      for (const sample of remaining.slice(0, 12)) sample.done = true;
      solderHeat = clamp(solderHeat + 0.24, 0, 1);
      audio.tone({ frequency: 210 + solderHeat * 70, type: 'sawtooth', duration: 0.10, gain: 0.026 });
      maybeFinishSolder();
      debug.stateChanged('cursed_secondhand_solder_keyboard', { heat: solderHeat });
      return true;
    }
    if (id === 'trace_pass') {
      const next = residue.filter((mote) => !mote.deposited).slice(0, 6);
      for (const mote of next) mote.deposited = true;
      audio.noise({ duration: 0.09, gain: 0.02, filterFrequency: 3400 });
      if (!traceSent && residue.every((mote) => mote.deposited)) {
        traceSent = true;
        const result = attempt('trace_pass', { tool: 'trace_salt', keyboard_equivalent: true, residue_motes: residue.length });
        if (!result.ok) traceSent = false;
      }
      debug.stateChanged('cursed_secondhand_trace_keyboard', { deposited: residue.filter((mote) => mote.deposited).length });
      return true;
    }
    return false;
  }

  function handleVerb(verb) {
    const id = pending();
    if (verb === 'reset_profile') {
      actions.resetProfile();
      resetInternal();
      return { handled: true };
    }
    if (verb === 'advance') return false;
    if (verb === 'interact') {
      if (!state().startedAt) { beginLedger(); return { handled: true }; }
      if (id === 'diagnose') {
        const next = hotspots.find((entry) => !entry.inspected);
        if (next) inspectHotspot(next);
        return { handled: true };
      }
      if (id === 'memory_clue') { inspectMemory(); return { handled: true }; }
      return false;
    }
    if (verb === 'core_action') {
      if (keyboardCore()) return { handled: true };
      return false;
    }
    if (verb === 'inspect') {
      if (id === 'interior_reveal') { startPortal(); return { handled: true }; }
      return false;
    }
    if (verb === 'commit_choice') {
      if (id === 'disposition') {
        dispositionPanel.node.hidden = false;
        debug.stateChanged('cursed_secondhand_disposition_open', {});
        return { handled: true };
      }
      return false;
    }
    return false;
  }

  function handlePlayerAction() { return false; }

  function resetInternal() {
    for (const hotspot of hotspots) hotspot.inspected = false;
    for (const cell of dustGrid.cells) cell.done = false;
    dustGrid.done = 0; brushCoverage = 0; dustSent = false;
    for (const sample of solderSamples) sample.done = false;
    solderHeat = 0; solderSent = false;
    for (const mote of residue) { mote.picked = false; mote.deposited = false; }
    residueLoaded = []; traceSent = false;
    portalStartedAt = 0; portalProgress = 0; portalSent = false;
    selectedDisposition = null;
    for (const key of Object.keys(keyboardProgress)) delete keyboardProgress[key];
    ledger.node.hidden = false;
    dispositionPanel.node.hidden = true;
    message = ''; messageUntil = 0;
    debug.stateChanged('cursed_secondhand_reset', {});
  }

  function drawWorkshop(time) {
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, '#11161c'); wall.addColorStop(1, '#171210');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#26303a'; ctx.fillRect(0, 0, W, 62);
    ctx.fillStyle = COLORS.cyan; ctx.font = '800 15px system-ui,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('BACK-ROOM RESTORATION // INTAKE 0417', 26, 39);
    ctx.fillStyle = COLORS.wood2; ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.fillStyle = COLORS.wood; ctx.fillRect(34, H * 0.75, W - 68, 24);

    // ledger / tool silhouettes
    ctx.fillStyle = COLORS.paper; ctx.fillRect(54, H * 0.78, 180, 112);
    ctx.strokeStyle = '#7c6848'; ctx.strokeRect(54, H * 0.78, 180, 112);
    ctx.fillStyle = COLORS.ink; ctx.font = '800 11px ui-monospace,monospace';
    ctx.fillText('INTAKE-0417', 70, H * 0.78 + 24);
    ctx.font = '10px ui-monospace,monospace';
    ctx.fillText('BRASS PENDULUM CLOCK', 70, H * 0.78 + 44);
    ctx.fillText('STOPPED: 04:17', 70, H * 0.78 + 62);

    // clock case
    const caseX = clock.x - clock.caseW / 2;
    const caseY = 70;
    const caseGrad = ctx.createLinearGradient(caseX, caseY, caseX + clock.caseW, caseY + clock.caseH);
    caseGrad.addColorStop(0, '#6d4a24'); caseGrad.addColorStop(.45, '#b17b36'); caseGrad.addColorStop(1, '#493119');
    ctx.fillStyle = caseGrad;
    roundedRect(ctx, caseX, caseY, clock.caseW, clock.caseH, 28); ctx.fill();
    ctx.strokeStyle = COLORS.brassHi; ctx.lineWidth = 4; ctx.stroke();

    // dial
    ctx.fillStyle = COLORS.cream; ctx.beginPath(); ctx.arc(dial.x, dial.y, dial.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COLORS.brass; ctx.lineWidth = 9; ctx.stroke();
    ctx.fillStyle = COLORS.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 12px serif';
    for (let i = 1; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.fillText(String(i), dial.x + Math.cos(a) * 70, dial.y + Math.sin(a) * 70);
    }
    // hands at 4:17
    const minuteA = (17 / 60) * Math.PI * 2 - Math.PI / 2;
    const hourA = ((4 + 17 / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = COLORS.ink; ctx.lineCap = 'round'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(dial.x, dial.y); ctx.lineTo(dial.x + Math.cos(minuteA) * 58, dial.y + Math.sin(minuteA) * 58); ctx.stroke();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(dial.x, dial.y); ctx.lineTo(dial.x + Math.cos(hourA) * 42, dial.y + Math.sin(hourA) * 42); ctx.stroke();
    ctx.fillStyle = COLORS.brass; ctx.beginPath(); ctx.arc(dial.x, dial.y, 7, 0, Math.PI * 2); ctx.fill();

    // pendulum, always visibly swinging in workshop
    const swing = Math.sin(time * 0.0022) * 0.35;
    const pivot = { x: clock.x, y: clock.y + 75 };
    const length = 105;
    const bob = { x: pivot.x + Math.sin(swing) * length, y: pivot.y + Math.cos(swing) * length };
    ctx.strokeStyle = COLORS.brassHi; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.lineTo(bob.x, bob.y); ctx.stroke();
    ctx.fillStyle = COLORS.brass; ctx.beginPath(); ctx.ellipse(bob.x, bob.y, 28, 35, swing, 0, Math.PI * 2); ctx.fill();

    // ticking synth after movement has been repaired
    if (done('solder_pass') && time - lastTickAt > 700 && !portalStartedAt) {
      audio.tone({ frequency: 880, type: 'square', duration: 0.018, gain: 0.009 });
      lastTickAt = time;
    }
  }

  function drawDiagnosis(time) {
    for (const hotspot of hotspots) {
      const pulse = 1 + Math.sin(time * 0.006 + hotspot.x) * 0.08;
      ctx.strokeStyle = hotspot.inspected ? COLORS.green : (hotspot.id === 'curse' ? COLORS.cold : COLORS.cyan);
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hotspot.x, hotspot.y, hotspot.r * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hotspot.inspected ? COLORS.green : COLORS.white;
      ctx.font = '800 9px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(hotspot.inspected ? `LOGGED // ${hotspot.id.toUpperCase()}` : hotspot.label, hotspot.x, hotspot.y + hotspot.r + 14);
    }
  }

  function drawDust() {
    const coverage = dustCoverage();
    for (const cell of dustGrid.cells) {
      if (cell.done) continue;
      ctx.fillStyle = 'rgba(74,64,54,.28)'; ctx.beginPath(); ctx.arc(cell.x, cell.y, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = COLORS.white; ctx.font = '700 12px system-ui,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`SOFT BRUSH // UNIQUE DIAL COVERAGE ${Math.round(coverage * 100)}%`, 36, 92);
    if (activePointer !== null && dragMode === 'brush' && lastPoint) {
      ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lastPoint.x, lastPoint.y, 24, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawSolder() {
    ctx.strokeStyle = COLORS.rust; ctx.lineWidth = 7; ctx.beginPath();
    crackPolyline.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    for (const sample of solderSamples) {
      if (!sample.done) continue;
      ctx.fillStyle = COLORS.brassHi; ctx.beginPath(); ctx.arc(sample.x, sample.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    const bar = { x: 36, y: 88, w: 220, h: 18 };
    ctx.fillStyle = '#20262d'; ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = solderHeat > .82 ? COLORS.red : COLORS.orange ?? '#ffad5c';
    ctx.fillRect(bar.x, bar.y, bar.w * solderHeat, bar.h);
    ctx.strokeStyle = COLORS.white; ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = COLORS.white; ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`SOLDER HEAT ${Math.round(solderHeat * 100)}% // trace the cracked joint`, bar.x, bar.y - 8);
    if (activePointer !== null && dragMode === 'solder' && lastPoint) {
      ctx.fillStyle = solderHeat > .6 ? '#ffd18c' : '#c85531'; ctx.beginPath(); ctx.arc(lastPoint.x, lastPoint.y, 9, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTrace() {
    ctx.strokeStyle = COLORS.brassHi; ctx.lineWidth = 3; ctx.strokeRect(tray.x, tray.y, tray.w, tray.h);
    ctx.fillStyle = '#2d261d'; ctx.fillRect(tray.x + 4, tray.y + 4, tray.w - 8, tray.h - 8);
    ctx.fillStyle = COLORS.gold; ctx.font = '800 10px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('TRACE SALT TRAY', tray.x + tray.w / 2, tray.y + 17);
    for (const mote of residue) {
      if (mote.deposited || mote.picked) continue;
      ctx.fillStyle = 'rgba(155,201,255,.78)'; ctx.beginPath(); ctx.arc(mote.x, mote.y, 7, 0, Math.PI * 2); ctx.fill();
    }
    const deposited = residue.filter((mote) => mote.deposited).length;
    for (let i = 0; i < deposited; i += 1) {
      const a = (i / Math.max(1, residue.length - 1)) * Math.PI * 1.25 + .25;
      ctx.fillStyle = COLORS.cold; ctx.beginPath();
      ctx.arc(tray.x + tray.w / 2 + Math.cos(a) * 42, tray.y + 48 + Math.sin(a) * 20, 3, 0, Math.PI * 2); ctx.fill();
    }
    if (residueLoaded.length && lastPoint) {
      ctx.strokeStyle = COLORS.cold; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(tray.x + tray.w / 2, tray.y + tray.h / 2); ctx.stroke();
    }
    ctx.fillStyle = COLORS.white; ctx.font = '700 12px system-ui,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`TRACE REAGENT // deposited ${deposited}/${residue.length}`, 36, 92);
  }

  function drawMemory() {
    ctx.strokeStyle = COLORS.cold; ctx.lineWidth = 3; ctx.strokeRect(tray.x, tray.y, tray.w, tray.h);
    ctx.fillStyle = 'rgba(155,201,255,.18)'; ctx.fillRect(tray.x, tray.y, tray.w, tray.h);
    // stylized hand reaching to a tiny clock
    ctx.strokeStyle = COLORS.cold; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tray.x + 38, tray.y + 62); ctx.lineTo(tray.x + 78, tray.y + 45); ctx.lineTo(tray.x + 104, tray.y + 36); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tray.x + 130, tray.y + 42, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = COLORS.white; ctx.font = '800 11px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PERSONAL MEMORY SHAPE // E or tap tray', tray.x + tray.w / 2, tray.y - 12);
  }

  function drawPortal(time) {
    if (!portalStartedAt) {
      ctx.strokeStyle = COLORS.violet; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(dial.x, dial.y, dial.r + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = COLORS.white; ctx.font = '800 12px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Q // OPEN THE CLOCK FACE', dial.x, dial.y - dial.r - 24);
      return;
    }
    const t = clamp((time - portalStartedAt) / 4200, 0, 1);
    portalProgress = t;
    const open = t < .22 ? t / .22 : t > .78 ? (1 - t) / .22 : 1;
    const width = portalRect.w * clamp(open, 0, 1);
    const x = portalRect.x + (portalRect.w - width) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, portalRect.y, width, portalRect.h); ctx.clip();
    const room = ctx.createLinearGradient(x, portalRect.y, x, portalRect.y + portalRect.h);
    room.addColorStop(0, '#302f49'); room.addColorStop(1, '#151224');
    ctx.fillStyle = room; ctx.fillRect(x, portalRect.y, width, portalRect.h);
    ctx.fillStyle = '#a88764'; ctx.fillRect(portalRect.x + 18, portalRect.y + 24, portalRect.w - 36, 20);
    ctx.fillStyle = '#74604c'; ctx.fillRect(portalRect.x + 34, portalRect.y + 152, 70, 62);
    ctx.fillStyle = '#b6d6e3'; ctx.fillRect(portalRect.x + 148, portalRect.y + 50, 58, 86);
    ctx.fillStyle = COLORS.white; ctx.font = '900 30px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillText('4:17', portalRect.x + portalRect.w / 2, portalRect.y + 122);
    // one explicit pendulum sweep inside the room
    const sweep = lerp(-.75, .75, clamp((t - .28) / .44, 0, 1));
    const px = portalRect.x + portalRect.w / 2, py = portalRect.y + 140, len = 70;
    ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + Math.sin(sweep) * len, py + Math.cos(sweep) * len); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = COLORS.violet; ctx.lineWidth = 5; ctx.strokeRect(x, portalRect.y, width, portalRect.h);
    ctx.fillStyle = COLORS.white; ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(t < .78 ? 'INTERIOR MEMORY // ONE PENDULUM SWEEP' : 'PORTAL CLOSING // RETURNING TO WORKSHOP', W / 2, 44);
  }

  function drawDispositionStamp() {
    if (!selectedDisposition) return;
    ctx.save();
    ctx.translate(144, H * .78 + 83); ctx.rotate(-.08);
    ctx.strokeStyle = selectedDisposition === 'seal' ? COLORS.red : selectedDisposition === 'archive' ? COLORS.gold : COLORS.green;
    ctx.lineWidth = 5; ctx.strokeRect(-62, -20, 124, 40);
    ctx.fillStyle = ctx.strokeStyle; ctx.font = '900 20px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(selectedDisposition.toUpperCase(), 0, 0); ctx.restore();
  }

  function drawEnding() {
    drawDispositionStamp();
    const s = state();
    ctx.fillStyle = 'rgba(8,12,16,.87)'; roundedRect(ctx, W - 320, 84, 278, 144, 14); ctx.fill();
    ctx.strokeStyle = COLORS.cyan; ctx.stroke();
    ctx.fillStyle = COLORS.cyan; ctx.font = '900 13px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillText(s.finished ? 'NEXT INTAKE LOGGED' : 'WORKSHOP RECORD READY', W - 296, 112);
    ctx.fillStyle = COLORS.white; ctx.font = '700 12px system-ui,sans-serif';
    ctx.fillText('INTAKE-0418', W - 296, 142);
    ctx.fillStyle = COLORS.muted; ctx.font = '11px system-ui,sans-serif';
    ctx.fillText('same cold-residue trace signature', W - 296, 165);
    ctx.fillText(s.finished ? 'Record closed.' : 'Press Enter to close Intake 0417.', W - 296, 194);
  }

  function render(time) {
    if (destroyed) return;
    drawWorkshop(time);
    const p = phase();
    ledger.node.hidden = p !== 'ledger';
    dispositionPanel.node.hidden = p !== 'disposition' || selectedDisposition !== null;

    if (p === 'diagnose') drawDiagnosis(time);
    else if (p === 'dust_pass') drawDust();
    else if (p === 'solder_pass') drawSolder();
    else if (p === 'trace_pass') drawTrace();
    else if (p === 'memory_clue') drawMemory();
    else if (p === 'interior_reveal') drawPortal(time);
    else if (p === 'disposition') drawDispositionStamp();
    else if (p === 'ready_complete' || p === 'complete') drawEnding();

    if (p === 'solder_pass' && activePointer === null) solderHeat = Math.max(0, solderHeat - 0.0018);
    if (p === 'interior_reveal') finishPortalIfReady(time);

    if (message && time < messageUntil) {
      ctx.fillStyle = 'rgba(5,8,11,.88)'; roundedRect(ctx, 34, H - 54, W - 68, 34, 10); ctx.fill();
      ctx.fillStyle = COLORS.white; ctx.font = '800 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(message, W / 2, H - 37);
    }

    frameId = requestAnimationFrame(render);
  }

  frameId = requestAnimationFrame(render);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frameId);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
    ledger.node.remove();
    dispositionPanel.node.remove();
    overlay.style.inset = overlayOld.inset;
    overlay.style.bottom = overlayOld.bottom;
    overlay.style.display = overlayOld.display;
    overlay.style.pointerEvents = overlayOld.pointerEvents;
  }

  function getDebugState() {
    return {
      phase: phase(),
      pending_step: pending(),
      hotspots: Object.fromEntries(hotspots.map((entry) => [entry.id, entry.inspected])),
      dust_coverage: Number(dustCoverage().toFixed(4)),
      solder_coverage: Number((solderSamples.filter((sample) => sample.done).length / solderSamples.length).toFixed(4)),
      solder_heat: Number(solderHeat.toFixed(3)),
      residue_deposited: residue.filter((mote) => mote.deposited).length,
      residue_total: residue.length,
      portal_active: Boolean(portalStartedAt),
      portal_progress: Number(portalProgress.toFixed(3)),
      disposition: selectedDisposition,
    };
  }

  return { handleVerb, handlePlayerAction, destroy, getDebugState };
}
