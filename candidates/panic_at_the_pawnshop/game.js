const COLORS = Object.freeze({
  ink: '#171318', paper: '#efe3c3', paper2: '#d8c799', desk: '#472f28', desk2: '#2b1b1a',
  felt: '#173b32', felt2: '#0f2924', brass: '#d6a84d', gold: '#f5ca62', uv: '#9a78ff',
  uvHot: '#d8c8ff', cyan: '#65d9e7', red: '#d84c4c', green: '#71d79a', blue: '#5795ff',
  amber: '#f0a94d', white: '#f7f2e7', muted: '#b9b0a2', black: '#070708', terminal: '#07120d',
  terminalGlow: '#65f49a',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const inside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function roundedPath(ctx, x, y, w, h, radius = 10) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRound(ctx, rect, fill, radius = 10, stroke = null, lineWidth = 1) {
  roundedPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawText(ctx, text, x, y, { font = '12px ui-monospace, SFMono-Regular, Menlo, monospace', fill = COLORS.white, align = 'left', baseline = 'alphabetic', alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, { font = '12px system-ui, sans-serif', fill = COLORS.ink, maxLines = 6, align = 'left' } = {}) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  const words = String(text ?? '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length > 0) {
    const last = lines[lines.length - 1];
    if (ctx.measureText(last).width >= maxWidth * .92) lines[lines.length - 1] = `${last.replace(/[.,;:]?$/, '')}…`;
  }
  lines.forEach((entry, index) => ctx.fillText(entry, x, y + index * lineHeight));
  ctx.restore();
  return lines.length;
}

function pointInTriangle(point, a, b, c) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function formatStepFinding(step) {
  return step?.finding ?? step?.label ?? step?.id ?? '';
}

export default function createGame({
  canvas, ctx, overlay, concept, scenario, getState, actions, audio, toCanvasPoint, debug,
}) {
  if (!canvas || !ctx || !overlay || !scenario || !getState || !actions) {
    throw new Error('panic_at_the_pawnshop requires the modular candidate Canvas host');
  }

  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;
  const oldOverlay = { pointerEvents: overlay.style.pointerEvents, display: overlay.style.display };
  overlay.style.pointerEvents = 'none';
  overlay.style.display = 'block';

  const G = Object.freeze({
    deskMat: { x: 42, y: 112, w: 532, h: 332 },
    terminal: { x: 594, y: 116, w: 176, h: 286 },
    terminalScreen: { x: 607, y: 140, w: 150, h: 165 },
    terminalButton: { x: 617, y: 323, w: 130, h: 38 },
    terminalCard: { x: 618, y: 371, w: 128, h: 22 },
    item: { x: 218, y: 166, w: 280, h: 190 },
    openButton: { x: 286, y: 392, w: 230, h: 44 },
    evidenceButton: { x: 283, y: 397, w: 238, h: 40 },
    cert: { x: 150, y: 104, w: 500, h: 294 },
    certSeal: { x: 506, y: 292, w: 98, h: 70 },
    choicePanel: { x: 122, y: 100, w: 556, h: 330 },
  });

  const STEP_ITEM = Object.freeze({
    watch_uv: 'chrono_sig_watch', watch_serial: 'chrono_sig_watch', appraise_watch: 'chrono_sig_watch',
    ledger_uv: 'bakery_ledger', ledger_provenance: 'bakery_ledger', appraise_ledger: 'bakery_ledger',
    card_uv: 'panic_edition_card', card_registry: 'panic_edition_card', appraise_card: 'panic_edition_card',
  });

  const APPRAISAL = Object.freeze({
    appraise_watch: { stamp: 'counterfeit', label: 'COUNTERFEIT', color: COLORS.red, item: 'chrono_sig_watch', evidence: ['watch_uv', 'watch_serial'] },
    appraise_ledger: { stamp: 'meaningful', label: 'MEANINGFUL', color: COLORS.green, item: 'bakery_ledger', evidence: ['ledger_uv', 'ledger_provenance'] },
    appraise_card: { stamp: 'scarcity', label: 'MANUFACTURED\nSCARCITY', color: COLORS.amber, item: 'panic_edition_card', evidence: ['card_uv', 'card_registry'] },
  });

  const STAMPS = [
    { id: 'counterfeit', label: 'COUNTERFEIT', x: 126, y: 414, w: 158, h: 64, color: COLORS.red },
    { id: 'meaningful', label: 'MEANINGFUL', x: 322, y: 414, w: 158, h: 64, color: COLORS.green },
    { id: 'scarcity', label: 'SCARCITY', x: 518, y: 414, w: 158, h: 64, color: COLORS.amber },
  ];

  const CHOICES = [
    { id: 'file_and_disclose', title: 'FILE + DISCLOSE', detail: 'Attach the evidence map to the shift ledger and warn sellers.', color: COLORS.green },
    { id: 'hold_for_review', title: 'HOLD TICKETS', detail: 'Freeze the three tickets for the morning manager to review.', color: COLORS.cyan },
    { id: 'book_quietly', title: 'BOOK QUIETLY', detail: 'Close the shift without naming the scarcity pattern.', color: COLORS.red },
  ];

  const itemById = (id) => scenario.items?.find((item) => item.item_id === id) ?? null;
  const stepById = (id) => scenario.steps?.find((step) => step.id === id) ?? null;
  const state = () => getState();
  const pendingId = () => state().pending_step?.id ?? null;
  const isDone = (id) => Boolean(state().completedSteps?.includes(id));

  let destroyed = false;
  let raf = 0;
  let phaseCache = null;
  let lastFrame = performance.now();
  let pointerId = null;
  let pointer = { x: W * .5, y: H * .5 };
  let pointerDown = false;
  let uvActive = false;
  let uvProgress = 0;
  let uvPos = { x: 360, y: 405 };
  let loupeActive = false;
  let loupeProgress = 0;
  let loupePos = { x: 375, y: 270 };
  let registry = { active: false, started: 0, completed: false, query: '', typed: 0 };
  let dragStamp = null;
  let stampAnimation = null;
  let finalStampMarks = new Map();
  let revealAnimation = 0;
  let revealStarted = false;
  let revealHoldUntil = 0;
  let choiceSelected = null;
  let shiftCloseAt = 0;
  let autoTool = null;
  let feedback = '';
  let feedbackBad = false;
  let feedbackUntil = 0;
  const particles = [];
  let seed = 0x51f15e;

  function rng() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  }

  function say(message, bad = false, duration = 1800) {
    feedback = message;
    feedbackBad = bad;
    feedbackUntil = performance.now() + duration;
    if (bad) {
      audio.noise({ duration: .05, gain: .025, filterFrequency: 620 });
      audio.tone({ frequency: 145, type: 'square', duration: .12, gain: .025 });
    } else {
      audio.tone({ frequency: 650, type: 'triangle', duration: .08, gain: .035 });
      audio.tone({ frequency: 870, type: 'sine', duration: .12, gain: .02 });
    }
    debug.stateChanged('pawnshop_feedback', { message, bad });
  }

  function attempt(id, payload = {}) {
    const result = actions.attemptStep(id, { source: 'panic_at_the_pawnshop_game', ...payload });
    if (!result.ok) {
      const detail = result.missing?.length ? `MISSING ${result.missing.join(' + ')}` : String(result.reason ?? 'BLOCKED').toUpperCase();
      say(`${id.toUpperCase()} // ${detail}`, true);
      return result;
    }
    if (result.reason !== 'already_completed') say(`${id.replaceAll('_', ' ').toUpperCase()} RECORDED`);
    return result;
  }

  function resetInternal() {
    pointerId = null; pointerDown = false; uvActive = false; uvProgress = 0; uvPos = { x: 360, y: 405 };
    loupeActive = false; loupeProgress = 0; loupePos = { x: 375, y: 270 };
    registry = { active: false, started: 0, completed: false, query: '', typed: 0 };
    dragStamp = null; stampAnimation = null; finalStampMarks = new Map(); revealAnimation = 0;
    revealStarted = false; revealHoldUntil = 0; choiceSelected = null; shiftCloseAt = 0; autoTool = null;
    particles.length = 0; feedback = ''; feedbackUntil = 0; phaseCache = null;
  }

  function openShift() {
    if (!state().startedAt) actions.startSession();
    if (pendingId() !== 'open_shift' && !isDone('open_shift')) return false;
    const result = isDone('open_shift') ? { ok: true } : attempt('open_shift', { subject: 'three_intake_tickets' });
    if (result.ok) {
      audio.tone({ frequency: 420, type: 'triangle', duration: .08, gain: .035 });
      audio.tone({ frequency: 520, type: 'triangle', duration: .12, gain: .025 });
    }
    return result.ok;
  }

  function registrySpec(id = pendingId()) {
    if (id === 'watch_serial') return { query: 'CS-0177-300', header: 'CHRONO-SIG SERIAL REGISTRY', result: 'NO MATCH // RUN ENDED AT 0150 // 0177 INVALID' };
    return { query: 'PANIC EDITION / PLATE-D', header: 'ISSUER BATCH REGISTRY', result: '4 BATCHES × “1 OF 500” // ≥ 2,000 COPIES' };
  }

  function startRegistryLookup() {
    const id = pendingId();
    if (id !== 'watch_serial' && id !== 'card_registry') return false;
    if (registry.active || registry.completed) return true;
    const spec = registrySpec(id);
    registry = { active: true, started: performance.now(), completed: false, query: spec.query, typed: 0 };
    audio.tone({ frequency: 220, type: 'square', duration: .04, gain: .018 });
    debug.stateChanged('pawnshop_registry_started', { step_id: id, query: spec.query });
    return true;
  }

  function completeRegistry(id) {
    if (registry.completed || pendingId() !== id) return;
    registry.completed = true;
    const step = stepById(id);
    const result = attempt(id, { tool: 'serial_registry', finding: formatStepFinding(step), query: registry.query, local_lookup: true });
    if (result.ok) {
      audio.tone({ frequency: 880, type: 'square', duration: .05, gain: .02 });
      audio.tone({ frequency: 1040, type: 'square', duration: .08, gain: .015 });
    }
  }

  function uvHotspot(id = pendingId()) {
    if (id === 'watch_uv') return { x: 368, y: 258, r: 64 };
    if (id === 'ledger_uv') return { x: 360, y: 252, r: 92 };
    return { x: 366, y: 256, r: 76 };
  }
  const loupeHotspot = () => ({ x: 405, y: 300, r: 47 });
  function uvTriangle() {
    const tip = { x: uvPos.x, y: uvPos.y - 13 };
    return [tip, { x: uvPos.x - 84, y: uvPos.y - 186 }, { x: uvPos.x + 84, y: uvPos.y - 186 }];
  }
  function uvOnHotspot() {
    const hotspot = uvHotspot();
    const [a, b, c] = uvTriangle();
    return pointInTriangle({ x: hotspot.x, y: hotspot.y }, a, b, c);
  }

  function beginAutoTool() {
    const id = pendingId();
    if (id?.endsWith('_uv')) { autoTool = { kind: 'uv', started: performance.now() }; uvActive = true; return true; }
    if (id === 'ledger_provenance') { autoTool = { kind: 'loupe', started: performance.now() }; loupeActive = true; return true; }
    if (id === 'watch_serial' || id === 'card_registry') return startRegistryLookup();
    if (id === 'scarcity_reveal') return exposeScheme();
    return false;
  }

  const appraisalSpec = (id = pendingId()) => APPRAISAL[id] ?? null;
  const itemEvidence = (spec) => spec.evidence.map((id) => stepById(id)).filter(Boolean);
  function stampRect(stamp) {
    if (dragStamp?.id === stamp.id) return { x: dragStamp.x, y: dragStamp.y, w: stamp.w, h: stamp.h };
    return { x: stamp.x, y: stamp.y, w: stamp.w, h: stamp.h };
  }

  function dropStamp(point) {
    if (!dragStamp) return false;
    const stamp = STAMPS.find((entry) => entry.id === dragStamp.id);
    const active = appraisalSpec();
    const rect = stampRect(stamp);
    dragStamp = null;
    if (!rectsOverlap(rect, G.certSeal) || !inside(point, G.certSeal)) {
      say('STAMP MISSED // PLACE IT INSIDE THE CERTIFICATE VERDICT BOX', true); return true;
    }
    if (!active || stamp.id !== active.stamp) {
      say('EVIDENCE CONFLICT // THIS STAMP IS NOT SUPPORTED BY THE RECORDED FINDINGS', true, 2300); return true;
    }
    const item = itemById(active.item);
    const now = performance.now();
    stampAnimation = { id: stamp.id, stepId: pendingId(), label: active.label, color: active.color, started: now, x: G.certSeal.x + G.certSeal.w / 2, y: G.certSeal.y + G.certSeal.h / 2 };
    const result = attempt(pendingId(), {
      item_id: item?.item_id, appraisal: item?.correct_appraisal, disposition: item?.correct_disposition,
      evidence: active.evidence, certificate_stamp: stamp.id,
    });
    if (result.ok) {
      finalStampMarks.set(active.item, { ...stampAnimation });
      audio.noise({ duration: .06, gain: .02, filterFrequency: 980 });
      audio.tone({ frequency: 115, type: 'triangle', duration: .14, gain: .05 });
      for (let i = 0; i < 18; i += 1) {
        const angle = rng() * Math.PI * 2; const speed = 24 + rng() * 55;
        particles.push({ x: stampAnimation.x, y: stampAnimation.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .45 + rng() * .35, age: 0, color: active.color });
      }
    }
    return true;
  }

  function keyboardStamp() {
    const active = appraisalSpec();
    if (!active) return false;
    const stamp = STAMPS.find((entry) => entry.id === active.stamp);
    dragStamp = { id: stamp.id, x: G.certSeal.x + 8, y: G.certSeal.y + 3 };
    return dropStamp({ x: G.certSeal.x + G.certSeal.w / 2, y: G.certSeal.y + G.certSeal.h / 2 });
  }

  function exposeScheme() {
    if (pendingId() !== 'scarcity_reveal') return false;
    if (revealStarted) return true;
    revealStarted = true; revealAnimation = 0.001; revealHoldUntil = performance.now() + 1750;
    const result = attempt('scarcity_reveal', {
      evidence: ['watch_uv', 'watch_serial', 'ledger_uv', 'ledger_provenance', 'card_uv', 'card_registry'],
      finding: formatStepFinding(stepById('scarcity_reveal')),
    });
    if (result.ok) {
      audio.tone({ frequency: 220, type: 'sawtooth', duration: .18, gain: .02 });
      audio.tone({ frequency: 330, type: 'triangle', duration: .28, gain: .025 });
      audio.tone({ frequency: 440, type: 'triangle', duration: .38, gain: .02 });
    }
    return result.ok;
  }

  function choiceRects() {
    return CHOICES.map((choice, index) => ({ ...choice, x: G.choicePanel.x + 28, y: G.choicePanel.y + 92 + index * 74, w: G.choicePanel.w - 56, h: 58 }));
  }

  function commitChoice(choiceId = 'file_and_disclose') {
    if (pendingId() !== 'commit_shift_disposition') return false;
    const choice = CHOICES.find((entry) => entry.id === choiceId) ?? CHOICES[0];
    const result = attempt('commit_shift_disposition', { option: choice.id, disposition: choice.id });
    if (!result.ok) return false;
    choiceSelected = choice.id; shiftCloseAt = performance.now();
    audio.tone({ frequency: 392, type: 'triangle', duration: .12, gain: .03 });
    audio.tone({ frequency: 523, type: 'triangle', duration: .20, gain: .022 });
    return true;
  }

  function enterPhase(id) {
    if (phaseCache === id) return;
    phaseCache = id; pointerDown = false; uvActive = false; loupeActive = false; autoTool = null; dragStamp = null;
    if (id?.endsWith('_uv')) { uvProgress = 0; uvPos = { x: 360, y: 420 }; }
    if (id === 'ledger_provenance') { loupeProgress = 0; loupePos = { x: 300, y: 282 }; }
    if (id === 'watch_serial' || id === 'card_registry') registry = { active: false, started: 0, completed: false, query: registrySpec(id).query, typed: 0 };
    if (id === 'scarcity_reveal') { revealAnimation = 0; revealStarted = false; }
    debug.stateChanged('pawnshop_phase', { pending_step: id });
  }

  function updateInspection(dt, now) {
    const id = pendingId();
    if (autoTool?.kind === 'uv') {
      const target = uvHotspot(id); const t = clamp((now - autoTool.started) / 650, 0, 1);
      uvPos.x = lerp(uvPos.x, target.x, .12); uvPos.y = lerp(uvPos.y, target.y + 163, .12); uvActive = true;
      if (t >= 1 && uvOnHotspot()) uvProgress = Math.min(1, uvProgress + dt * .95);
    }
    if (id?.endsWith('_uv') && uvActive && uvOnHotspot()) {
      uvProgress = Math.min(1, uvProgress + dt * .72);
      if (uvProgress >= 1 && pendingId() === id) {
        uvActive = false; autoTool = null;
        const step = stepById(id);
        const result = attempt(id, { tool: 'uv_lamp', finding: formatStepFinding(step), authored_mark_exposed: true });
        if (result.ok) audio.noise({ duration: .045, gain: .015, filterFrequency: 2200 });
      }
    }
    if (autoTool?.kind === 'loupe') {
      const target = loupeHotspot(); loupePos.x = lerp(loupePos.x, target.x, .12); loupePos.y = lerp(loupePos.y, target.y, .12); loupeActive = true;
    }
    if (id === 'ledger_provenance' && loupeActive && dist(loupePos, loupeHotspot()) < 46) {
      loupeProgress = Math.min(1, loupeProgress + dt * .82);
      if (loupeProgress >= 1 && pendingId() === id) {
        loupeActive = false; autoTool = null;
        const step = stepById(id);
        attempt(id, { tool: 'loupe', finding: formatStepFinding(step), handwriting_checked: true, photograph_found: true });
      }
    }
    if ((id === 'watch_serial' || id === 'card_registry') && registry.active && !registry.completed) {
      const elapsed = now - registry.started; registry.typed = clamp(elapsed / 520, 0, 1); if (elapsed >= 1250) completeRegistry(id);
    }
    if (revealStarted) revealAnimation = Math.min(1, revealAnimation + dt * .62);
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const p = particles[index]; p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 42 * dt;
      if (p.age >= p.life) particles.splice(index, 1);
    }
  }

  function drawDesk(time) {
    const gradient = ctx.createLinearGradient(0, 0, W, H); gradient.addColorStop(0, COLORS.desk); gradient.addColorStop(1, COLORS.desk2);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = .14; ctx.strokeStyle = '#e7bd85'; ctx.lineWidth = 1;
    for (let y = 22; y < H; y += 54) {
      ctx.beginPath(); ctx.moveTo(0, y + Math.sin(y * .07) * 5);
      for (let x = 0; x <= W; x += 32) ctx.lineTo(x, y + Math.sin((x + y) * .035) * 6);
      ctx.stroke();
    }
    ctx.restore();
    fillRound(ctx, G.deskMat, COLORS.felt, 18, '#36685d', 2);
    const matGrad = ctx.createRadialGradient(315, 260, 20, 315, 260, 270); matGrad.addColorStop(0, '#285749'); matGrad.addColorStop(1, COLORS.felt2);
    ctx.save(); ctx.globalAlpha = .6; roundedPath(ctx, G.deskMat.x + 8, G.deskMat.y + 8, G.deskMat.w - 16, G.deskMat.h - 16, 13); ctx.fillStyle = matGrad; ctx.fill(); ctx.restore();
    drawText(ctx, 'PAWNSHOP // CLOSING SHIFT', 54, 94, { font: '700 13px ui-monospace, monospace', fill: COLORS.gold });
    drawText(ctx, concept?.role ?? '', 54, 107, { font: '10px system-ui, sans-serif', fill: COLORS.muted });
    const flicker = .55 + Math.sin(time * .004) * .08;
    ctx.save(); ctx.globalAlpha = flicker;
    const lamp = ctx.createRadialGradient(240, 120, 12, 240, 120, 180); lamp.addColorStop(0, 'rgba(255,226,160,.34)'); lamp.addColorStop(1, 'rgba(255,226,160,0)');
    ctx.fillStyle = lamp; ctx.fillRect(50, 90, 380, 250); ctx.restore();
  }

  function drawTicket(ticket, x, y, index, current = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate((index - 1) * .015);
    fillRound(ctx, { x: 0, y: 0, w: 215, h: 66 }, current ? '#fff0c8' : COLORS.paper, 5, current ? COLORS.gold : '#a78d62', current ? 2 : 1);
    ctx.strokeStyle = '#bca77f'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(12, 49); ctx.lineTo(202, 49); ctx.stroke(); ctx.setLineDash([]);
    drawText(ctx, `INTAKE 0${index + 1}`, 11, 16, { font: '700 9px ui-monospace, monospace', fill: '#705d43' });
    drawText(ctx, ticket.display_name.replace(/\s+/g, ' ').slice(0, 27), 11, 31, { font: '700 10px system-ui, sans-serif', fill: COLORS.ink });
    drawText(ctx, ticket.ticket_claim.slice(0, 47), 11, 44, { font: '8px system-ui, sans-serif', fill: '#5e5142' });
    const appraiseId = ['appraise_watch', 'appraise_ledger', 'appraise_card'][index];
    if (isDone(appraiseId)) {
      ctx.save(); ctx.translate(168, 12); ctx.rotate(-.08);
      ctx.strokeStyle = index === 0 ? COLORS.red : index === 1 ? COLORS.green : COLORS.amber; ctx.lineWidth = 2; ctx.strokeRect(-34, -8, 66, 19);
      drawText(ctx, index === 0 ? 'FAKE' : index === 1 ? 'REAL' : 'SCARCITY', 0, 2, { font: '700 8px ui-monospace, monospace', fill: ctx.strokeStyle, align: 'center' }); ctx.restore();
    }
    ctx.restore();
  }

  function activeItemIndex() {
    const id = STEP_ITEM[pendingId()];
    if (id === 'chrono_sig_watch') return 0; if (id === 'bakery_ledger') return 1; if (id === 'panic_edition_card') return 2;
    if (pendingId() === 'scarcity_reveal' || pendingId() === 'commit_shift_disposition' || state().finished) return 2;
    return 0;
  }
  function drawTickets() {
    const active = activeItemIndex();
    (scenario.items ?? []).forEach((ticket, index) => drawTicket(ticket, 54 + index * 237, 22, index, index === active && Boolean(state().startedAt)));
  }

  function drawWatch({ uv = false, magnified = false } = {}) {
    const cx = 360, cy = 252; ctx.save(); ctx.translate(cx, cy); ctx.scale(magnified ? 1.35 : 1, magnified ? 1.35 : 1);
    fillRound(ctx, { x: -28, y: -101, w: 56, h: 73 }, '#6c4d35', 10, '#231814', 2); fillRound(ctx, { x: -28, y: 28, w: 56, h: 73 }, '#6c4d35', 10, '#231814', 2);
    ctx.fillStyle = '#b9b4a7'; ctx.beginPath(); ctx.arc(0, 0, 74, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#eee7d6'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#16191c'; ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 12; i += 1) {
      const a = -Math.PI / 2 + i * Math.PI / 6, x = Math.cos(a) * 49, y = Math.sin(a) * 49;
      ctx.fillStyle = uv ? '#d8cbff' : '#d0b56f'; ctx.fillRect(x - 2.5, y - 5, 5, 10);
    }
    ctx.strokeStyle = '#f4e9c5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(28, -16); ctx.moveTo(0, 3); ctx.lineTo(-4, -38); ctx.stroke();
    ctx.fillStyle = COLORS.brass; ctx.beginPath(); ctx.arc(0, 3, 5, 0, Math.PI * 2); ctx.fill();
    drawText(ctx, 'CHRONO-SIG', 0, 26, { font: '700 8px system-ui, sans-serif', fill: '#d8d2c4', align: 'center' });
    drawText(ctx, 'FOUNDERS RUN', 0, 38, { font: '7px system-ui, sans-serif', fill: '#8f9296', align: 'center' });
    if (uv) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.shadowBlur = 11; ctx.shadowColor = COLORS.uvHot; ctx.strokeStyle = COLORS.uvHot; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 57, 0, Math.PI * 2); ctx.stroke();
      drawText(ctx, 'EVEN LUME', 0, -6, { font: '700 10px ui-monospace, monospace', fill: COLORS.uvHot, align: 'center' });
      drawText(ctx, 'POST-PLATE CUT', 0, 54, { font: '700 8px ui-monospace, monospace', fill: '#ffb8ff', align: 'center' }); ctx.restore();
    }
    ctx.restore();
  }

  function drawLedger({ uv = false, magnified = false } = {}) {
    const x = 254, y = 186, w = 244, h = 150; ctx.save();
    if (magnified) { ctx.translate(360, 260); ctx.scale(1.45, 1.45); ctx.translate(-360, -260); }
    fillRound(ctx, { x, y, w, h }, '#775437', 7, '#352519', 3); fillRound(ctx, { x: x + 14, y: y + 12, w: w - 28, h: h - 22 }, '#e4d4ad', 4, '#9a865f', 1);
    ctx.strokeStyle = '#b5a27b'; ctx.lineWidth = 1;
    for (let yy = y + 34; yy < y + h - 15; yy += 15) { ctx.beginPath(); ctx.moveTo(x + 26, yy); ctx.lineTo(x + w - 26, yy); ctx.stroke(); }
    ctx.strokeStyle = '#8c7860'; ctx.beginPath(); ctx.moveTo(x + w / 2, y + 15); ctx.lineTo(x + w / 2, y + h - 14); ctx.stroke();
    for (const [text, tx, ty] of [['flour 18.40', x + 34, y + 47], ['mixer repair', x + 34, y + 77], ['staff cake', x + 34, y + 107], ['closed today', x + 144, y + 94], ['sold the mixer', x + 144, y + 109]]) {
      drawText(ctx, text, tx, ty, { font: 'italic 10px Georgia, serif', fill: uv ? '#5f5271' : '#4f4238' });
    }
    drawText(ctx, '1994—2001', x + w / 2, y + 29, { font: '700 9px ui-monospace, monospace', fill: '#5c4d3d', align: 'center' });
    ctx.fillStyle = '#d6c59d'; ctx.fillRect(x + w - 48, y + h - 36, 28, 20); drawText(ctx, 'PHOTO', x + w - 34, y + h - 23, { font: '700 6px ui-monospace, monospace', fill: '#655746', align: 'center' });
    if (uv) {
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(158,130,255,.16)'; ctx.fillRect(x + 18, y + 17, w - 36, h - 30); ctx.shadowBlur = 8; ctx.shadowColor = COLORS.uvHot;
      drawText(ctx, 'DULL STOCK / NO OPTICAL BRIGHTENER', x + w / 2, y + 67, { font: '700 9px ui-monospace, monospace', fill: COLORS.uvHot, align: 'center' });
      drawText(ctx, 'INK AGES PAGE → PAGE', x + w / 2, y + 130, { font: '700 9px ui-monospace, monospace', fill: '#bde6ff', align: 'center' }); ctx.restore();
    }
    if (magnified) {
      drawText(ctx, 'closed today, sold the mixer', x + 136, y + 104, { font: 'italic 11px Georgia, serif', fill: '#342b25' });
      drawText(ctx, '6 names on photo reverse', x + 132, y + 126, { font: '700 8px ui-monospace, monospace', fill: '#6e493e' });
    }
    ctx.restore();
  }

  function drawCard({ uv = false, magnified = false } = {}) {
    const x = 292, y = 172, w = 150, h = 176; ctx.save();
    if (magnified) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(1.35, 1.35); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    fillRound(ctx, { x: x - 10, y: y - 12, w: w + 20, h: h + 24 }, 'rgba(225,235,240,.16)', 9, '#b8c1c6', 1.5);
    const grad = ctx.createLinearGradient(x, y, x + w, y + h); grad.addColorStop(0, '#1d1530'); grad.addColorStop(.45, '#4b203d'); grad.addColorStop(1, '#131828');
    fillRound(ctx, { x, y, w, h }, grad, 7, '#dfb85e', 2);
    ctx.save(); ctx.globalAlpha = .28;
    for (let i = -40; i < w + 60; i += 18) { ctx.strokeStyle = i % 36 === 0 ? '#ffcf70' : '#7fe1ff'; ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + 76, y + h); ctx.stroke(); }
    ctx.restore();
    drawText(ctx, 'PANIC', x + w / 2, y + 49, { font: '900 30px Impact, system-ui, sans-serif', fill: COLORS.gold, align: 'center' });
    drawText(ctx, 'EDITION', x + w / 2, y + 69, { font: '800 16px system-ui, sans-serif', fill: '#fff0c3', align: 'center' });
    fillRound(ctx, { x: x + 26, y: y + 92, w: w - 52, h: 38 }, '#f3e4bd', 4, '#6c5c4a', 1);
    drawText(ctx, '1 OF 500', x + w / 2, y + 116, { font: '900 16px ui-monospace, monospace', fill: '#1c1920', align: 'center' });
    drawText(ctx, 'FACTORY SEALED', x + w / 2, y + 155, { font: '700 8px ui-monospace, monospace', fill: '#dcd6d0', align: 'center' });
    if (uv) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.shadowBlur = 12; ctx.shadowColor = COLORS.uvHot;
      fillRound(ctx, { x: x + 28, y: y + 136, w: w - 56, h: 24 }, 'rgba(109,76,255,.20)', 5, COLORS.uvHot, 1);
      drawText(ctx, 'PLATE-D', x + w / 2, y + 152, { font: '900 12px ui-monospace, monospace', fill: COLORS.uvHot, align: 'center' });
      drawText(ctx, 'A / C / D ALL “1 OF 500”', x + w / 2, y + 17, { font: '700 8px ui-monospace, monospace', fill: '#efc1ff', align: 'center' }); ctx.restore();
    }
    ctx.restore();
  }

  function drawObjectForStep(id, opts = {}) {
    const item = STEP_ITEM[id] ?? STEP_ITEM[phaseCache];
    if (item === 'chrono_sig_watch') drawWatch(opts); else if (item === 'bakery_ledger') drawLedger(opts); else drawCard(opts);
  }

  function drawItemTitle(id = pendingId()) {
    const item = itemById(STEP_ITEM[id]); if (!item) return;
    drawText(ctx, item.display_name, 307, 376, { font: '700 12px system-ui, sans-serif', fill: COLORS.white, align: 'center' });
    drawText(ctx, item.ticket_claim, 307, 391, { font: '10px system-ui, sans-serif', fill: '#c6c2bb', align: 'center' });
  }

  function drawUvCone(time) {
    const [tip, left, right] = uvTriangle();
    ctx.save(); const cone = ctx.createLinearGradient(tip.x, tip.y, (left.x + right.x) / 2, left.y);
    cone.addColorStop(0, 'rgba(145,104,255,.05)'); cone.addColorStop(.45, 'rgba(145,104,255,.20)'); cone.addColorStop(1, 'rgba(201,180,255,.34)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.closePath(); ctx.clip(); ctx.globalCompositeOperation = 'screen'; drawObjectForStep(pendingId(), { uv: true }); ctx.restore();
    ctx.save(); ctx.translate(uvPos.x, uvPos.y); ctx.rotate(Math.sin(time * .004) * .025);
    fillRound(ctx, { x: -23, y: -10, w: 46, h: 22 }, '#29232e', 8, COLORS.uv, 2); fillRound(ctx, { x: -10, y: 8, w: 20, h: 49 }, '#1d1a21', 6, '#625378', 1);
    ctx.fillStyle = uvActive ? COLORS.uvHot : '#6f5b8c'; ctx.fillRect(-15, -15, 30, 7); drawText(ctx, 'UV', 0, 4, { font: '900 8px ui-monospace, monospace', fill: COLORS.uvHot, align: 'center' }); ctx.restore();
    const hotspot = uvHotspot(); ctx.save(); ctx.globalAlpha = .35; ctx.strokeStyle = COLORS.uvHot; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(hotspot.x, hotspot.y, hotspot.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    drawProgress('UV EXPOSURE', uvProgress, 68, 418, 128, COLORS.uv);
  }

  function drawLoupe() {
    const r = 58; ctx.save(); ctx.beginPath(); ctx.arc(loupePos.x, loupePos.y, r - 6, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = '#f7edcf'; ctx.fillRect(loupePos.x - r, loupePos.y - r, r * 2, r * 2);
    ctx.translate(loupePos.x, loupePos.y); ctx.scale(1.6, 1.6); ctx.translate(-loupePos.x, -loupePos.y); drawLedger({ magnified: true }); ctx.restore();
    ctx.save(); ctx.strokeStyle = '#bcae97'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(loupePos.x, loupePos.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = '#43392f'; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(loupePos.x + 41, loupePos.y + 41); ctx.lineTo(loupePos.x + 88, loupePos.y + 88); ctx.stroke(); ctx.restore();
    const hotspot = loupeHotspot(); ctx.save(); ctx.globalAlpha = .35; ctx.strokeStyle = COLORS.gold; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(hotspot.x, hotspot.y, hotspot.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    drawProgress('LOUPE FOCUS', loupeProgress, 68, 418, 128, COLORS.gold);
  }

  function drawProgress(label, progress, x, y, width, color) {
    drawText(ctx, label, x, y - 7, { font: '700 9px ui-monospace, monospace', fill: COLORS.muted });
    fillRound(ctx, { x, y, w: width, h: 10 }, '#090d0c', 5, '#45645d', 1);
    if (progress > 0) fillRound(ctx, { x: x + 1, y: y + 1, w: Math.max(4, (width - 2) * progress), h: 8 }, color, 4);
    drawText(ctx, `${Math.round(progress * 100)}%`, x + width + 9, y + 9, { font: '700 9px ui-monospace, monospace', fill: COLORS.white });
  }

  function drawTerminal(time) {
    fillRound(ctx, G.terminal, '#242525', 9, '#776f63', 2); fillRound(ctx, G.terminalScreen, COLORS.terminal, 5, '#334d3e', 2);
    const id = pendingId(), spec = registrySpec(id);
    drawText(ctx, 'LOCAL REGISTRY // OFFLINE', G.terminalScreen.x + 8, G.terminalScreen.y + 16, { font: '700 8px ui-monospace, monospace', fill: COLORS.terminalGlow });
    drawText(ctx, spec.header, G.terminalScreen.x + 8, G.terminalScreen.y + 34, { font: '700 8px ui-monospace, monospace', fill: '#a6d9b5' });
    ctx.save(); ctx.globalAlpha = .08 + Math.sin(time * .013) * .025; ctx.fillStyle = COLORS.terminalGlow;
    for (let y = G.terminalScreen.y; y < G.terminalScreen.y + G.terminalScreen.h; y += 4) ctx.fillRect(G.terminalScreen.x, y, G.terminalScreen.w, 1); ctx.restore();
    const query = registry.active || registry.completed ? registry.query.slice(0, Math.ceil(registry.query.length * registry.typed)) : '';
    drawText(ctx, `> ${query}${registry.active && !registry.completed && Math.floor(time / 280) % 2 ? '█' : ''}`, G.terminalScreen.x + 8, G.terminalScreen.y + 62, { font: '700 9px ui-monospace, monospace', fill: COLORS.terminalGlow });
    if (registry.active) {
      const elapsed = performance.now() - registry.started;
      drawText(ctx, elapsed < 650 ? 'SEARCHING LOCAL INDEX…' : elapsed < 1200 ? 'VERIFYING BATCH RECORD…' : spec.result, G.terminalScreen.x + 8, G.terminalScreen.y + 92, { font: '700 8px ui-monospace, monospace', fill: elapsed < 1200 ? '#8cd4a2' : '#ffd67d' });
      if (elapsed >= 1200) wrapText(ctx, spec.result, G.terminalScreen.x + 8, G.terminalScreen.y + 112, G.terminalScreen.w - 14, 11, { font: '700 8px ui-monospace, monospace', fill: '#ffd67d', maxLines: 3 });
    } else drawText(ctx, 'READY FOR QUERY', G.terminalScreen.x + 8, G.terminalScreen.y + 92, { font: '700 8px ui-monospace, monospace', fill: '#628c70' });
    fillRound(ctx, G.terminalButton, registry.active ? '#213329' : '#353a35', 6, registry.active ? '#6bbf88' : '#7a8077', 1);
    drawText(ctx, registry.active ? 'LOOKUP RUNNING…' : 'RUN LOCAL LOOKUP [E]', G.terminalButton.x + G.terminalButton.w / 2, G.terminalButton.y + 24, { font: '700 10px ui-monospace, monospace', fill: registry.active ? COLORS.terminalGlow : COLORS.white, align: 'center' });
    fillRound(ctx, G.terminalCard, '#161717', 4, '#57504b', 1); drawText(ctx, 'NO NETWORK // SHOP ARCHIVE', G.terminalCard.x + G.terminalCard.w / 2, G.terminalCard.y + 15, { font: '700 7px ui-monospace, monospace', fill: '#8c8178', align: 'center' });
  }

  function drawBriefing() {
    ctx.save(); ctx.fillStyle = 'rgba(7,6,8,.72)'; ctx.fillRect(0, 0, W, H);
    const box = { x: 152, y: 118, w: 496, h: 244 }; fillRound(ctx, box, '#efe3c3', 8, '#d1b66c', 2);
    drawText(ctx, 'SHIFT BRIEFING // 21:47', box.x + 24, box.y + 30, { font: '900 13px ui-monospace, monospace', fill: '#5e3e28' });
    drawText(ctx, 'THREE INTAKE TICKETS. ONE CLOSING SHIFT.', box.x + 24, box.y + 55, { font: '900 19px system-ui, sans-serif', fill: COLORS.ink });
    wrapText(ctx, 'Inspect each item with the authored evidence tools. The UV lamp reveals hidden marks, the loupe magnifies handwriting, and the registry terminal checks only the shop’s local records. Appraise only after corroboration.', box.x + 24, box.y + 82, box.w - 48, 18, { font: '12px system-ui, sans-serif', fill: '#43382e', maxLines: 5 });
    ['01 CHRONO-SIG WATCH', '02 BAKERY LEDGER', '03 PANIC EDITION CARD'].forEach((label, index) => {
      fillRound(ctx, { x: box.x + 24 + index * 148, y: box.y + 162, w: 136, h: 38 }, index === 0 ? '#ead6a5' : '#e4d2aa', 4, '#a88f5e', 1);
      drawText(ctx, label, box.x + 92 + index * 148, box.y + 186, { font: '700 8px ui-monospace, monospace', fill: '#49392a', align: 'center' });
    });
    fillRound(ctx, G.openButton, '#322b24', 7, COLORS.gold, 2);
    drawText(ctx, 'OPEN SHIFT + READ TICKETS [E]', G.openButton.x + G.openButton.w / 2, G.openButton.y + 27, { font: '900 11px ui-monospace, monospace', fill: COLORS.gold, align: 'center' }); ctx.restore();
  }

  function drawInspectionScene(time) {
    const id = pendingId(); drawObjectForStep(id); drawItemTitle(id);
    if (id?.endsWith('_uv')) drawUvCone(time); else if (id === 'ledger_provenance') drawLoupe();
    if (id === 'watch_serial' || id === 'card_registry') drawTerminal(time);
    else {
      drawText(ctx, 'TOOLS', 608, 132, { font: '700 9px ui-monospace, monospace', fill: COLORS.muted });
      fillRound(ctx, { x: 602, y: 145, w: 160, h: 84 }, '#251f25', 8, '#65556f', 1);
      drawText(ctx, 'UV LAMP', 622, 174, { font: '700 10px ui-monospace, monospace', fill: COLORS.uvHot });
      drawText(ctx, 'LOUPE', 622, 199, { font: '700 10px ui-monospace, monospace', fill: COLORS.gold });
      drawText(ctx, id?.endsWith('_uv') ? 'DRAG / HOLD OVER MARKS' : 'DRAG LENS OVER FINAL PAGE', 622, 216, { font: '7px ui-monospace, monospace', fill: COLORS.muted });
    }
    const step = stepById(id);
    if (step) {
      fillRound(ctx, { x: 594, y: 414, w: 176, h: 58 }, '#151718', 7, '#4e5557', 1);
      drawText(ctx, step.tool === 'uv_lamp' ? 'UV SWEEP' : step.tool === 'loupe' ? 'LOUPE CHECK' : 'REGISTRY LOOKUP', 606, 433, { font: '900 9px ui-monospace, monospace', fill: step.tool === 'uv_lamp' ? COLORS.uvHot : step.tool === 'loupe' ? COLORS.gold : COLORS.terminalGlow });
      wrapText(ctx, step.label, 606, 449, 150, 11, { font: '8px system-ui, sans-serif', fill: COLORS.white, maxLines: 2 });
    }
  }

  function drawEvidenceLine(step, x, y, width, color) {
    fillRound(ctx, { x, y, w: width, h: 57 }, '#f5ead0', 5, '#baa77d', 1); fillRound(ctx, { x: x + 7, y: y + 8, w: 56, h: 18 }, color, 3);
    drawText(ctx, step.tool === 'uv_lamp' ? 'UV' : step.tool === 'loupe' ? 'LOUPE' : 'REGISTRY', x + 35, y + 21, { font: '900 7px ui-monospace, monospace', fill: '#151314', align: 'center' });
    wrapText(ctx, step.finding, x + 72, y + 15, width - 80, 11, { font: '8px system-ui, sans-serif', fill: '#3c3229', maxLines: 4 });
  }

  function drawStamp(stamp, current, time) {
    const rect = stampRect(stamp), isActive = current?.stamp === stamp.id; ctx.save(); const bob = isActive ? Math.sin(time * .006) * 2 : 0; ctx.translate(rect.x, rect.y + bob);
    fillRound(ctx, { x: 0, y: 28, w: rect.w, h: 32 }, '#251c1a', 7, isActive ? stamp.color : '#655753', isActive ? 2 : 1);
    fillRound(ctx, { x: rect.w / 2 - 26, y: 0, w: 52, h: 34 }, '#6c4b31', 13, '#2e2017', 2); fillRound(ctx, { x: 9, y: 38, w: rect.w - 18, h: 14 }, stamp.color, 3);
    drawText(ctx, stamp.label, rect.w / 2, 49, { font: '900 9px ui-monospace, monospace', fill: '#140f0e', align: 'center' });
    if (!isActive) { ctx.fillStyle = 'rgba(10,8,9,.46)'; roundedPath(ctx, 0, 0, rect.w, rect.h, 7); ctx.fill(); }
    ctx.restore();
  }

  function drawCertificate(time, overrideStepId = null) {
    const active = overrideStepId ? APPRAISAL[overrideStepId] ?? null : appraisalSpec(); const item = active ? itemById(active.item) : null;
    if (!active || !item) return;
    ctx.save(); ctx.fillStyle = 'rgba(5,4,5,.38)'; ctx.fillRect(0, 0, W, H); fillRound(ctx, G.cert, '#e8dbb9', 6, '#b49253', 2);
    ctx.strokeStyle = '#8e6d3b'; ctx.lineWidth = 1; ctx.strokeRect(G.cert.x + 12, G.cert.y + 12, G.cert.w - 24, G.cert.h - 24);
    drawText(ctx, 'EVIDENCE-BACKED APPRAISAL CERTIFICATE', G.cert.x + 24, G.cert.y + 34, { font: '900 13px ui-monospace, monospace', fill: '#3d2d22' });
    drawText(ctx, item.display_name, G.cert.x + 24, G.cert.y + 55, { font: '800 14px system-ui, sans-serif', fill: COLORS.ink });
    drawText(ctx, `CLAIM: ${item.ticket_claim}`, G.cert.x + 24, G.cert.y + 72, { font: '8px system-ui, sans-serif', fill: '#605246' });
    const evidence = itemEvidence(active), color = active.stamp === 'counterfeit' ? '#d79090' : active.stamp === 'meaningful' ? '#8ecba2' : '#d8b36e';
    drawEvidenceLine(evidence[0], G.cert.x + 24, G.cert.y + 91, G.cert.w - 48, color); drawEvidenceLine(evidence[1], G.cert.x + 24, G.cert.y + 155, G.cert.w - 48, color);
    drawText(ctx, 'VERDICT // DROP THE EVIDENCE-SUPPORTED STAMP HERE', G.cert.x + 24, G.cert.y + 235, { font: '900 9px ui-monospace, monospace', fill: '#5b4937' });
    fillRound(ctx, G.certSeal, '#d8c79f', 5, '#8a6f42', 1.5); ctx.save(); ctx.strokeStyle = '#9c7f4a'; ctx.setLineDash([3, 4]); ctx.strokeRect(G.certSeal.x + 6, G.certSeal.y + 6, G.certSeal.w - 12, G.certSeal.h - 12); ctx.restore();
    drawText(ctx, 'STAMP', G.certSeal.x + G.certSeal.w / 2, G.certSeal.y + 40, { font: '900 10px ui-monospace, monospace', fill: '#8f7b57', align: 'center' });
    drawText(ctx, `DISPOSITION: ${item.correct_disposition.replaceAll('_', ' ').toUpperCase()}`, G.cert.x + 24, G.cert.y + 278, { font: '700 8px ui-monospace, monospace', fill: '#5c4a39' }); ctx.restore();
    STAMPS.forEach((stamp) => drawStamp(stamp, active, time));
    if (stampAnimation) {
      const t = clamp((performance.now() - stampAnimation.started) / 520, 0, 1);
      if (t < 1) {
        const scale = t < .42 ? lerp(1.35, .82, t / .42) : lerp(.82, 1.08, (t - .42) / .58);
        ctx.save(); ctx.translate(stampAnimation.x, stampAnimation.y); ctx.rotate(-.08); ctx.scale(scale, scale); ctx.globalAlpha = .85; ctx.strokeStyle = stampAnimation.color; ctx.lineWidth = 3; ctx.strokeRect(-58, -18, 116, 36);
        drawText(ctx, stampAnimation.label.replace('\n', ' '), 0, 4, { font: '900 11px ui-monospace, monospace', fill: stampAnimation.color, align: 'center' }); ctx.restore();
      }
    }
  }

  function drawEvidenceBoard(time) {
    ctx.save(); ctx.fillStyle = 'rgba(5,4,5,.35)'; ctx.fillRect(0, 0, W, H); const board = { x: 100, y: 93, w: 600, h: 300 };
    fillRound(ctx, board, '#6e4a35', 8, '#c18e53', 3); fillRound(ctx, { x: board.x + 13, y: board.y + 13, w: board.w - 26, h: board.h - 26 }, '#8b6749', 4, '#4e3428', 1);
    drawText(ctx, 'SHIFT EVIDENCE BOARD // PRICE-BUBBLE TRACE', board.x + 24, board.y + 34, { font: '900 12px ui-monospace, monospace', fill: '#f0d29a' });
    const cards = [
      { x: 128, y: 152, w: 156, h: 156, title: 'CHRONO-SIG', tag: 'COUNTERFEIT', body: 'Invalid serial + fresh-cut engraving. Fake made to ride the boom.', color: COLORS.red },
      { x: 322, y: 152, w: 156, h: 156, title: 'BAKERY LEDGER', tag: 'MEANINGFUL', body: 'Authentic history. Low market value. No reason to manufacture it.', color: COLORS.green },
      { x: 516, y: 152, w: 156, h: 156, title: 'PANIC EDITION', tag: 'SCARCITY', body: 'Four genuine batches all printed “1 of 500”. Scarcity itself is false.', color: COLORS.amber },
    ];
    cards.forEach((card) => {
      fillRound(ctx, card, '#ede0bd', 5, '#b89b69', 1); ctx.fillStyle = card.color; ctx.beginPath(); ctx.arc(card.x + card.w / 2, card.y + 12, 5, 0, Math.PI * 2); ctx.fill();
      drawText(ctx, card.title, card.x + 12, card.y + 33, { font: '900 10px ui-monospace, monospace', fill: COLORS.ink }); fillRound(ctx, { x: card.x + 12, y: card.y + 45, w: card.w - 24, h: 24 }, card.color, 4);
      drawText(ctx, card.tag, card.x + card.w / 2, card.y + 61, { font: '900 9px ui-monospace, monospace', fill: '#161214', align: 'center' }); wrapText(ctx, card.body, card.x + 12, card.y + 88, card.w - 24, 13, { font: '9px system-ui, sans-serif', fill: '#40342b', maxLines: 5 });
    });
    const progress = revealStarted ? Math.max(revealAnimation, .05) : .05 + Math.sin(time * .003) * .015;
    ctx.save(); ctx.strokeStyle = '#b52833'; ctx.lineWidth = 3; ctx.shadowBlur = 6; ctx.shadowColor = '#8e1e28'; const center = { x: 400, y: 342 };
    cards.forEach((card, index) => { const target = { x: card.x + card.w / 2, y: card.y + card.h }, local = clamp(progress * 1.25 - index * .13, 0, 1); ctx.beginPath(); ctx.moveTo(target.x, target.y); ctx.lineTo(lerp(target.x, center.x, local), lerp(target.y, center.y, local)); ctx.stroke(); }); ctx.restore();
    if (revealStarted) {
      ctx.save(); ctx.globalAlpha = (.75 + Math.sin(time * .01) * .18) * revealAnimation; fillRound(ctx, { x: 286, y: 326, w: 228, h: 37 }, '#2d1518', 6, '#e15e66', 2);
      drawText(ctx, 'MANUFACTURED SCARCITY', 400, 350, { font: '900 14px ui-monospace, monospace', fill: '#ff8c94', align: 'center' }); ctx.restore();
    }
    ctx.restore(); fillRound(ctx, G.evidenceButton, revealStarted ? '#382328' : '#2b2924', 7, revealStarted ? COLORS.red : COLORS.gold, 2);
    drawText(ctx, revealStarted ? 'SCHEME EXPOSED // BOARD PINNED' : 'CONNECT EVIDENCE + EXPOSE SCHEME [Q]', G.evidenceButton.x + G.evidenceButton.w / 2, G.evidenceButton.y + 25, { font: '900 10px ui-monospace, monospace', fill: revealStarted ? '#ff9ba1' : COLORS.gold, align: 'center' });
  }

  function drawChoice() {
    ctx.save(); ctx.fillStyle = 'rgba(5,4,5,.58)'; ctx.fillRect(0, 0, W, H); fillRound(ctx, G.choicePanel, '#e9ddbe', 8, '#c9a85a', 2);
    drawText(ctx, 'FINAL SHIFT DISPOSITION', G.choicePanel.x + 26, G.choicePanel.y + 34, { font: '900 15px ui-monospace, monospace', fill: '#34271f' });
    drawText(ctx, 'The evidence is filed. Decide how the closing shift records the scheme.', G.choicePanel.x + 26, G.choicePanel.y + 57, { font: '11px system-ui, sans-serif', fill: '#51463b' });
    for (const rect of choiceRects()) {
      const selected = choiceSelected === rect.id; fillRound(ctx, rect, selected ? '#d5c49e' : '#f4e8ca', 6, selected ? rect.color : '#a78e63', selected ? 3 : 1);
      fillRound(ctx, { x: rect.x + 12, y: rect.y + 11, w: 132, h: 35 }, rect.color, 5); drawText(ctx, rect.title, rect.x + 78, rect.y + 33, { font: '900 9px ui-monospace, monospace', fill: '#151214', align: 'center' });
      drawText(ctx, rect.detail, rect.x + 158, rect.y + 25, { font: '10px system-ui, sans-serif', fill: '#41372f' }); drawText(ctx, selected ? 'COMMITTED' : 'CLICK TO COMMIT', rect.x + rect.w - 18, rect.y + 42, { font: '700 8px ui-monospace, monospace', fill: selected ? rect.color : '#88775e', align: 'right' });
    }
    ctx.restore();
  }

  function drawComplete(time) {
    ctx.save(); ctx.fillStyle = 'rgba(4,4,5,.74)'; ctx.fillRect(0, 0, W, H); const box = { x: 151, y: 130, w: 498, h: 238 };
    fillRound(ctx, box, '#1a201d', 9, COLORS.green, 2); drawText(ctx, 'SHIFT CLOSED // EVIDENCE FILED', 400, 170, { font: '900 18px ui-monospace, monospace', fill: COLORS.green, align: 'center' });
    drawText(ctx, 'MANUFACTURED SCARCITY EXPOSED', 400, 203, { font: '900 24px system-ui, sans-serif', fill: COLORS.white, align: 'center' });
    wrapText(ctx, scenario.next_shift_hook, 400, 239, 420, 18, { font: '12px system-ui, sans-serif', fill: '#cbd8cf', maxLines: 4, align: 'center' });
    ctx.globalAlpha = .55 + Math.sin(time * .006) * .12; drawText(ctx, 'NEXT SHIFT QUEUE: 9 MORE PANIC EDITION COPIES', 400, 326, { font: '900 11px ui-monospace, monospace', fill: COLORS.gold, align: 'center' }); ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) { ctx.save(); ctx.globalAlpha = clamp(1 - p.age / p.life, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); ctx.restore(); }
  }
  function drawFeedback(now) {
    if (!feedback || now > feedbackUntil) return;
    const box = { x: 200, y: 78, w: 400, h: 32 }; fillRound(ctx, box, feedbackBad ? 'rgba(69,18,23,.94)' : 'rgba(18,51,37,.94)', 6, feedbackBad ? COLORS.red : COLORS.green, 1.5);
    drawText(ctx, feedback, box.x + box.w / 2, box.y + 21, { font: '900 9px ui-monospace, monospace', fill: feedbackBad ? '#ffacb0' : '#b9ffd0', align: 'center' });
  }
  function drawFooter() {
    const id = pendingId(); if (!state().startedAt) return;
    const controls = id?.endsWith('_uv') ? 'DRAG UV LAMP • Q = ASSIST SWEEP' : id === 'ledger_provenance' ? 'DRAG LOUPE • Q = ASSIST FOCUS' : id === 'watch_serial' || id === 'card_registry' ? 'CLICK TERMINAL • E = RUN LOOKUP' : id?.startsWith('appraise_') ? 'DRAG CORRECT STAMP TO CERTIFICATE • SPACE = KEYBOARD STAMP' : id === 'scarcity_reveal' ? 'CLICK BOARD BUTTON • Q = EXPOSE SCHEME' : id === 'commit_shift_disposition' ? 'CLICK A SHIFT DISPOSITION • F = FILE + DISCLOSE' : 'ENTER = ADVANCE';
    drawText(ctx, controls, 54, 486, { font: '700 9px ui-monospace, monospace', fill: '#d5cdbf' });
  }

  function render(now) {
    drawDesk(now); drawTickets(); const id = pendingId();
    const stampHolding = stampAnimation && now - stampAnimation.started < 650, revealHolding = revealHoldUntil > now, choiceHolding = shiftCloseAt && now - shiftCloseAt < 1050;
    if (!state().startedAt || id === 'open_shift') drawBriefing();
    else if (stampHolding) drawCertificate(now, stampAnimation.stepId);
    else if (revealHolding) drawEvidenceBoard(now);
    else if (choiceHolding) drawChoice();
    else if (id?.endsWith('_uv') || id === 'watch_serial' || id === 'ledger_provenance' || id === 'card_registry') drawInspectionScene(now);
    else if (id?.startsWith('appraise_')) drawCertificate(now);
    else if (id === 'scarcity_reveal') drawEvidenceBoard(now);
    else if (id === 'commit_shift_disposition') drawChoice();
    else if (!id && state().startedAt && !state().finished) drawChoice();
    else if (state().finished) drawComplete(now);
    drawParticles(); drawFeedback(now); drawFooter();
  }

  function frame(now) {
    if (destroyed) return;
    const dt = clamp((now - lastFrame) / 1000, 0, .05); lastFrame = now; enterPhase(pendingId()); updateInspection(dt, now); ctx.clearRect(0, 0, W, H); render(now); raf = requestAnimationFrame(frame);
  }

  function onPointerDown(event) {
    if (destroyed || pointerId !== null) return;
    const p = toCanvasPoint(event); if (!p.inside) return; pointerId = event.pointerId; pointer = { x: p.x, y: p.y }; pointerDown = true;
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    const id = pendingId();
    if (!state().startedAt || id === 'open_shift') { if (inside(p, G.openButton)) openShift(); return; }
    if (id?.endsWith('_uv')) { uvActive = true; uvPos = { x: p.x, y: p.y }; autoTool = null; audio.tone({ frequency: 115, type: 'sawtooth', duration: .05, gain: .012 }); return; }
    if (id === 'ledger_provenance') { loupeActive = true; loupePos = { x: p.x, y: p.y }; autoTool = null; return; }
    if (id === 'watch_serial' || id === 'card_registry') { if (inside(p, G.terminalButton) || inside(p, G.terminalScreen)) startRegistryLookup(); return; }
    if (id?.startsWith('appraise_')) {
      for (const stamp of STAMPS) if (inside(p, stampRect(stamp))) { dragStamp = { id: stamp.id, x: p.x - stamp.w / 2, y: p.y - stamp.h / 2 }; audio.tone({ frequency: 190, type: 'triangle', duration: .045, gain: .018 }); return; }
      return;
    }
    if (id === 'scarcity_reveal') { if (inside(p, G.evidenceButton)) exposeScheme(); return; }
    if (id === 'commit_shift_disposition') { const choice = choiceRects().find((rect) => inside(p, rect)); if (choice) commitChoice(choice.id); }
  }

  function onPointerMove(event) {
    if (destroyed || event.pointerId !== pointerId) return;
    const p = toCanvasPoint(event); pointer = { x: p.x, y: p.y }; const id = pendingId();
    if (id?.endsWith('_uv') && pointerDown) uvPos = { x: p.x, y: p.y };
    if (id === 'ledger_provenance' && pointerDown) loupePos = { x: p.x, y: p.y };
    if (dragStamp) { const stamp = STAMPS.find((entry) => entry.id === dragStamp.id); dragStamp.x = p.x - stamp.w / 2; dragStamp.y = p.y - stamp.h / 2; }
  }

  function releasePointer(event) {
    if (event.pointerId !== pointerId) return;
    const p = toCanvasPoint(event), id = pendingId(); if (id?.startsWith('appraise_') && dragStamp) dropStamp(p);
    uvActive = false; loupeActive = false; pointerDown = false;
    try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {}
    pointerId = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  function handleVerb(verb) {
    if (verb === 'reset_profile') { const result = actions.resetProfile(); resetInternal(); return { handled: true, result }; }
    if (verb === 'advance') {
      if (!state().startedAt) return { handled: true, result: actions.startSession() };
      if (!pendingId() && !state().finished) return { handled: true, result: actions.completeScenario({ source: 'pawnshop_keyboard' }) };
      return { handled: true, ok: false };
    }
    if (verb === 'interact') {
      const id = pendingId(); if (id === 'open_shift') return { handled: true, ok: openShift() };
      if (id?.endsWith('_uv') || id === 'ledger_provenance' || id === 'watch_serial' || id === 'card_registry') return { handled: true, ok: beginAutoTool() };
      return { handled: true, ok: false };
    }
    if (verb === 'inspect') return { handled: true, ok: beginAutoTool() };
    if (verb === 'core_action') {
      const active = appraisalSpec(); if (active) return { handled: true, ok: keyboardStamp() };
      const blockedTarget = scenario.steps?.find((step) => step.kind === 'core_action' && !isDone(step.id));
      if (blockedTarget) return { handled: true, result: attempt(blockedTarget.id, { source: 'unsupported_keyboard_appraisal' }) };
      return { handled: true, ok: false };
    }
    if (verb === 'commit_choice') return { handled: true, ok: commitChoice('file_and_disclose') };
    return false;
  }

  function handlePlayerAction() { return false; }

  function destroy() {
    destroyed = true; cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', onPointerDown); canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', releasePointer); canvas.removeEventListener('pointercancel', releasePointer); overlay.style.pointerEvents = oldOverlay.pointerEvents; overlay.style.display = oldOverlay.display;
  }

  function getDebugState() {
    return {
      phase: pendingId(), active_item: STEP_ITEM[pendingId()] ?? null,
      uv: { active: uvActive, progress: Number(uvProgress.toFixed(3)), position: { ...uvPos }, hotspot: uvHotspot(pendingId()), overlapping: pendingId()?.endsWith('_uv') ? uvOnHotspot() : false },
      loupe: { active: loupeActive, progress: Number(loupeProgress.toFixed(3)), position: { ...loupePos } }, registry: { ...registry },
      dragging_stamp: dragStamp ? { ...dragStamp } : null, stamped_items: [...finalStampMarks.keys()], reveal_progress: Number(revealAnimation.toFixed(3)), choice: choiceSelected,
    };
  }

  raf = requestAnimationFrame(frame);
  return { handleVerb, handlePlayerAction, destroy, getDebugState };
}
