let audioCtx = null;
function playFx(freq, type = 'sine', dur = 0.15) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.07, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {
    // Audio is optional; a locked AudioContext must never block play.
  }
}

const GAME1 = 'fake_it_till_you_clean_it';

export function initCanvasRenderer(canvas, getStateFn, dispatchFn) {
  const ctx = canvas.getContext('2d');
  const goldLayer = document.createElement('canvas');
  goldLayer.width = canvas.width;
  goldLayer.height = canvas.height;
  const goldCtx = goldLayer.getContext('2d');

  let particles = [];
  let pointerDown = false;
  let pointerX = canvas.width / 2;
  let pointerY = canvas.height / 2;
  let pointerTravel = 0;
  let dispatchedThisGesture = false;
  let waterLevel = 1;
  let safeOpen = 0;
  let vanityClean = 0;
  let revealHoldUntil = 0;
  let previousCompleted = new Set();
  let previousSession = null;
  const peelStrokes = [];
  const coverage = {
    basin: new Set(),
    deck: new Set(),
    vanity: new Set(),
  };
  let debris = makeDebris();
  let vanityTrash = makeVanityTrash();

  const CELL = 16;
  const targetTotals = {
    basin: countTargetCells('basin'),
    deck: countTargetCells('deck'),
    vanity: countTargetCells('vanity'),
  };

  canvas.addEventListener('pointerdown', (e) => {
    const state = normalizedState();
    const p = canvasPoint(e);
    pointerDown = true;
    pointerX = p.x;
    pointerY = p.y;
    pointerTravel = 0;
    dispatchedThisGesture = false;
    canvas.setPointerCapture?.(e.pointerId);

    if (state?.concept?.concept_id !== GAME1) {
      spawnParticles(p.x, p.y, 20, '#e3b341', 'spark');
      playFx(320, 'sawtooth', 0.12);
      dispatchFn('core_action');
      dispatchedThisGesture = true;
      return;
    }

    if (state.current_step?.id === 'drain_pool') {
      playFx(145, 'square', 0.16);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = canvasPoint(e);
    const dx = p.x - pointerX;
    const dy = p.y - pointerY;
    pointerX = p.x;
    pointerY = p.y;
    if (!pointerDown) return;
    pointerTravel += Math.hypot(dx, dy);

    const state = normalizedState();
    if (state?.concept?.concept_id === GAME1) {
      applyGame1Brush(state, p.x, p.y);
    } else {
      spawnParticles(p.x, p.y, 3, '#58a6ff', 'spray');
    }
  });

  const releasePointer = (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    canvas.releasePointerCapture?.(e.pointerId);
    const state = normalizedState();
    if (state?.concept?.concept_id === GAME1 && !dispatchedThisGesture) {
      const step = state.current_step;
      if (step?.id === 'drain_pool' && pointerTravel < 24) {
        dispatchCoreOnce();
      } else if (step?.kind === 'core_action' && !['collect_debris', 'strip_basin', 'strip_deck', 'restore_glamour_vanity'].includes(step.id) && pointerTravel < 24) {
        dispatchCoreOnce();
      }
    }
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  function normalizedState() {
    const raw = getStateFn();
    if (!raw) return raw;
    const completed = raw.completedSteps ?? raw.completed_step_ids ?? [];
    const currentStep = raw.scenario?.steps?.find((step) => !completed.includes(step.id)) ?? null;
    return {
      ...raw,
      completed_step_ids: completed,
      current_step: currentStep,
    };
  }

  function visualSpec(state, stepId) {
    return state?.scenario?.visual_contract?.stages?.[stepId] ?? {};
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function dispatchCoreOnce() {
    if (dispatchedThisGesture) return;
    dispatchedThisGesture = true;
    dispatchFn('core_action');
  }

  function applyGame1Brush(state, x, y) {
    const step = state.current_step;
    if (!step || step.kind !== 'core_action' || dispatchedThisGesture) return;
    const spec = visualSpec(state, step.id);
    const radius = spec.brush_radius_px ?? 30;
    const threshold = spec.completion_threshold ?? 0.55;

    if (step.id === 'collect_debris') {
      let hit = 0;
      for (const item of debris) {
        if (item.alive && Math.hypot(item.x - x, item.y - y) <= radius) {
          item.alive = false;
          hit += 1;
          spawnFlakes(item.x, item.y, 4, '#b9c0c7', 'dust');
        }
      }
      if (hit) playFx(210, 'triangle', 0.04);
      const removed = debris.filter((item) => !item.alive).length / debris.length;
      if (removed >= threshold) dispatchCoreOnce();
      return;
    }

    if (step.id === 'strip_basin') {
      if (!insideTarget('basin', x, y)) return;
      const ratio = stampCoverage('basin', x, y, radius);
      peelStrokes.push({ zone: 'basin', x, y, r: radius * (0.78 + Math.random() * 0.22) });
      spawnSpray(x, y, 4);
      spawnFlakes(x, y, 3, '#f6c945', 'gold');
      if (Math.random() < 0.22) playFx(260, 'sawtooth', 0.035);
      if (ratio >= threshold) dispatchCoreOnce();
      return;
    }

    if (step.id === 'strip_deck') {
      if (!insideTarget('deck', x, y)) return;
      const ratio = stampCoverage('deck', x, y, radius);
      peelStrokes.push({ zone: 'deck', x, y, r: radius * (0.8 + Math.random() * 0.2) });
      spawnSpray(x, y, 3);
      spawnFlakes(x, y, 3, '#e7b52d', 'gold');
      if (ratio >= threshold) dispatchCoreOnce();
      return;
    }

    if (step.id === 'restore_glamour_vanity') {
      if (!insideTarget('vanity', x, y)) return;
      const ratio = stampCoverage('vanity', x, y, radius);
      spawnSpray(x, y, 4);
      for (const item of vanityTrash) {
        if (item.alive && Math.hypot(item.x - x, item.y - y) <= radius + 12) {
          item.alive = false;
          spawnFlakes(item.x, item.y, 4, '#d4bdc8', 'dust');
        }
      }
      vanityClean = Math.max(vanityClean, ratio);
      const trashRemoved = vanityTrash.filter((item) => !item.alive).length / vanityTrash.length;
      if (Math.max(ratio, trashRemoved) >= threshold) dispatchCoreOnce();
    }
  }

  function stampCoverage(zone, x, y, radius) {
    const set = coverage[zone];
    const minGX = Math.floor((x - radius) / CELL);
    const maxGX = Math.ceil((x + radius) / CELL);
    const minGY = Math.floor((y - radius) / CELL);
    const maxGY = Math.ceil((y + radius) / CELL);
    for (let gx = minGX; gx <= maxGX; gx += 1) {
      for (let gy = minGY; gy <= maxGY; gy += 1) {
        const cx = gx * CELL + CELL / 2;
        const cy = gy * CELL + CELL / 2;
        if (Math.hypot(cx - x, cy - y) > radius) continue;
        if (!insideTarget(zone, cx, cy)) continue;
        set.add(`${gx}:${gy}`);
      }
    }
    return Math.min(1, set.size / Math.max(1, targetTotals[zone]));
  }

  function countTargetCells(zone) {
    let count = 0;
    for (let x = CELL / 2; x < canvas.width; x += CELL) {
      for (let y = CELL / 2; y < canvas.height; y += CELL) {
        if (insideTarget(zone, x, y)) count += 1;
      }
    }
    return count;
  }

  function insideTarget(zone, x, y) {
    const g = geometry();
    if (zone === 'basin') {
      return ((x - g.pool.cx) / g.pool.rx) ** 2 + ((y - g.pool.cy) / g.pool.ry) ** 2 <= 0.92;
    }
    if (zone === 'deck') {
      return x >= g.deck.x && x <= g.deck.x + g.deck.w && y >= g.deck.y && y <= g.deck.y + g.deck.h;
    }
    if (zone === 'vanity') {
      return x >= g.vanity.x && x <= g.vanity.x + g.vanity.w && y >= g.vanity.y && y <= g.vanity.y + g.vanity.h;
    }
    return false;
  }

  function geometry() {
    const w = canvas.width;
    const h = canvas.height;
    return {
      pool: { cx: w * 0.5, cy: h * 0.58, rx: w * 0.3, ry: h * 0.24 },
      deck: { x: w * 0.08, y: h * 0.72, w: w * 0.84, h: h * 0.12 },
      vanity: { x: w * 0.2, y: h * 0.62, w: w * 0.6, h: h * 0.16 },
    };
  }

  function syncGame1Transitions(state, time) {
    if (previousSession !== state.sessionId) {
      previousSession = state.sessionId;
      previousCompleted = new Set();
      coverage.basin.clear();
      coverage.deck.clear();
      coverage.vanity.clear();
      peelStrokes.length = 0;
      debris = makeDebris();
      vanityTrash = makeVanityTrash();
      waterLevel = 1;
      safeOpen = 0;
      vanityClean = 0;
      revealHoldUntil = 0;
    }

    const completed = new Set(state.completed_step_ids ?? []);
    for (const id of completed) {
      if (previousCompleted.has(id)) continue;
      if (id === 'collect_debris') {
        debris.forEach((item) => { item.alive = false; });
        spawnFlakes(canvas.width * 0.5, canvas.height * 0.56, 18, '#cbd5e1', 'dust');
      } else if (id === 'drain_pool') {
        spawnFlakes(canvas.width * 0.5, canvas.height * 0.58, 26, '#67e8f9', 'water');
      } else if (id === 'strip_basin') {
        seedFullPeel('basin', 44);
        spawnFlakes(canvas.width * 0.5, canvas.height * 0.57, 50, '#fde047', 'gold');
      } else if (id === 'strip_deck') {
        seedFullPeel('deck', 46);
        spawnFlakes(canvas.width * 0.5, canvas.height * 0.76, 48, '#facc15', 'gold');
      } else if (id === 'reveal_decayed_surface') {
        revealHoldUntil = time + (visualSpec(state, id).reveal_hold_ms ?? 900);
        playFx(510, 'triangle', 0.28);
      } else if (id === 'restore_glamour_vanity') {
        vanityClean = 1;
        vanityTrash.forEach((item) => { item.alive = false; });
        spawnFlakes(canvas.width * 0.5, canvas.height * 0.69, 30, '#e2e8f0', 'dust');
      } else if (id === 'safe_receipt_clue') {
        playFx(690, 'triangle', 0.3);
      }
    }
    previousCompleted = completed;
  }

  function seedFullPeel(zone, count) {
    const g = geometry();
    for (let i = 0; i < count; i += 1) {
      const a = seeded(i + (zone === 'deck' ? 400 : 100));
      const b = seeded(i + (zone === 'deck' ? 900 : 600));
      if (zone === 'basin') {
        const angle = a * Math.PI * 2;
        const rr = Math.sqrt(b) * 0.9;
        peelStrokes.push({
          zone,
          x: g.pool.cx + Math.cos(angle) * g.pool.rx * rr,
          y: g.pool.cy + Math.sin(angle) * g.pool.ry * rr,
          r: 24 + a * 20,
        });
      } else {
        peelStrokes.push({
          zone,
          x: g.deck.x + a * g.deck.w,
          y: g.deck.y + b * g.deck.h,
          r: 20 + b * 18,
        });
      }
    }
  }

  function loop(time) {
    const state = normalizedState();
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!state || !state.concept) {
      ctx.fillStyle = '#0f111a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#58a6ff';
      ctx.font = 'bold 24px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CONNECTING TO GAME ENGINE...', w / 2, h / 2);
      requestAnimationFrame(loop);
      return;
    }

    const cid = state.concept.concept_id;
    const step = state.current_step;
    const stepId = step?.id || '';

    if (cid === GAME1) {
      syncGame1Transitions(state, time);
      renderFakeItPolished(ctx, w, h, state, step, time);
    } else if (cid === 'return_to_sender') {
      renderReturnToSender(ctx, w, h, state, stepId, time);
    } else if (cid === 'theme_park_liquidation') {
      renderThemePark(ctx, w, h, state, stepId, time);
    } else if (cid === 'cursed_secondhand') {
      renderCursedSecondhand(ctx, w, h, state, stepId, time);
    } else if (cid === 'panic_at_the_pawnshop') {
      renderPawnshop(ctx, w, h, state, stepId, time);
    }

    updateGame1Animation(state);
    renderParticles(ctx);
    updateHUD(state);
    requestAnimationFrame(loop);
  }

  function updateGame1Animation(state) {
    if (state?.concept?.concept_id !== GAME1) return;
    const completed = new Set(state.completed_step_ids ?? []);
    const waterTarget = completed.has('drain_pool') ? 0 : 1;
    waterLevel += (waterTarget - waterLevel) * 0.08;
    const safeTarget = completed.has('safe_receipt_clue') ? 1 : 0;
    safeOpen += (safeTarget - safeOpen) * 0.09;
    const vanityTarget = completed.has('restore_glamour_vanity') ? 1 : Math.min(1, coverage.vanity.size / Math.max(1, targetTotals.vanity));
    vanityClean += (vanityTarget - vanityClean) * 0.12;
  }

  function renderFakeItPolished(ctx, w, h, state, step, time) {
    const completed = new Set(state.completed_step_ids ?? []);
    const revealSeen = completed.has('reveal_decayed_surface');
    const showVanity = revealSeen && time >= revealHoldUntil && (step?.area_id === 'glamour_vanity' || completed.has('restore_glamour_vanity') || completed.has('safe_receipt_clue'));
    if (showVanity) renderVanity(ctx, w, h, state, step, completed, time);
    else renderPool(ctx, w, h, state, step, completed, time);
  }

  function renderPool(ctx, w, h, state, step, completed, time) {
    const g = geometry();
    const reveal = completed.has('reveal_decayed_surface');
    const basinDone = completed.has('strip_basin');
    const deckDone = completed.has('strip_deck');

    const wall = ctx.createLinearGradient(0, 0, 0, h * 0.72);
    wall.addColorStop(0, '#161b26');
    wall.addColorStop(0.52, '#262134');
    wall.addColorStop(1, '#111720');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#0c1118';
    ctx.fillRect(35, 38, 26, h * 0.66);
    ctx.fillRect(w - 61, 38, 26, h * 0.66);
    ctx.strokeStyle = 'rgba(244,63,94,0.4)';
    ctx.setLineDash([9, 10]);
    ctx.strokeRect(w * 0.1, h * 0.14, w * 0.8, h * 0.55);
    ctx.setLineDash([]);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CAMERA FRAME A // LUXURY POOL', w * 0.11, h * 0.17);

    ctx.fillStyle = '#4c4b45';
    ctx.fillRect(g.deck.x, g.deck.y, g.deck.w, g.deck.h);
    drawConcreteNoise(ctx, g.deck.x, g.deck.y, g.deck.w, g.deck.h, reveal ? 0.9 : 0.45);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(g.pool.cx, g.pool.cy, g.pool.rx, g.pool.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    const concrete = ctx.createRadialGradient(g.pool.cx - 90, g.pool.cy - 65, 20, g.pool.cx, g.pool.cy, g.pool.rx);
    concrete.addColorStop(0, '#7a7b73');
    concrete.addColorStop(0.5, '#4e554f');
    concrete.addColorStop(1, '#252b28');
    ctx.fillStyle = concrete;
    ctx.fillRect(g.pool.cx - g.pool.rx, g.pool.cy - g.pool.ry, g.pool.rx * 2, g.pool.ry * 2);
    drawAlgae(ctx, g, reveal ? 1 : 0.45);
    if (reveal || basinDone) drawPoolCracks(ctx, g, reveal ? 1 : 0.3);
    ctx.restore();

    renderGoldLayer(g, completed);
    ctx.drawImage(goldLayer, 0, 0);

    if (waterLevel > 0.015) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(g.pool.cx, g.pool.cy, g.pool.rx - 4, g.pool.ry - 4, 0, 0, Math.PI * 2);
      ctx.clip();
      const top = g.pool.cy + g.pool.ry - (g.pool.ry * 2 * waterLevel);
      const water = ctx.createLinearGradient(0, top, 0, g.pool.cy + g.pool.ry);
      water.addColorStop(0, 'rgba(66,211,235,0.62)');
      water.addColorStop(1, 'rgba(2,84,120,0.78)');
      ctx.fillStyle = water;
      ctx.fillRect(g.pool.cx - g.pool.rx, top, g.pool.rx * 2, g.pool.cy + g.pool.ry - top);
      ctx.strokeStyle = 'rgba(190,250,255,0.72)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 7; i += 1) {
        ctx.beginPath();
        for (let x = g.pool.cx - g.pool.rx + 20; x < g.pool.cx + g.pool.rx - 20; x += 9) {
          const y = top + i * 13 + Math.sin(x * 0.035 + time * 0.004 + i) * 3;
          if (x === g.pool.cx - g.pool.rx + 20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.strokeStyle = reveal ? '#73776f' : '#efcf69';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.ellipse(g.pool.cx, g.pool.cy, g.pool.rx + 5, g.pool.ry + 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (!completed.has('collect_debris')) {
      for (const item of debris) {
        if (!item.alive) continue;
        ctx.fillStyle = '#20252b';
        ctx.fillRect(item.x - item.r, item.y - item.r * 0.45, item.r * 2, item.r * 0.9);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(item.x - 1.4, item.y - item.r, 2.8, item.r * 2);
      }
    }

    if (!deckDone) {
      ctx.fillStyle = '#fff3a4';
      for (let i = 0; i < 28; i += 1) {
        const a = i * 2.39 + time * 0.0002;
        const rr = 35 + (i * 37) % (g.pool.rx * 0.9);
        const x = g.pool.cx + Math.cos(a) * rr;
        const y = g.pool.cy + Math.sin(a) * rr * 0.45;
        ctx.globalAlpha = 0.26 + Math.max(0, Math.sin(time * 0.004 + i)) * 0.55;
        ctx.beginPath();
        ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (reveal) {
      ctx.fillStyle = 'rgba(3,9,12,0.9)';
      ctx.fillRect(w * 0.28, h * 0.63, w * 0.44, 42);
      ctx.strokeStyle = '#22d3ee';
      ctx.strokeRect(w * 0.28, h * 0.63, w * 0.44, 42);
      ctx.fillStyle = '#a5f3fc';
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SHOT LIST FOUND: “GOLD ONLY WHERE FRAME REACHES”', w * 0.5, h * 0.63 + 25);
    }

    drawGame1BrushHUD(ctx, state, step, basinDone, deckDone);
  }

  function renderGoldLayer(g, completed) {
    goldCtx.clearRect(0, 0, goldLayer.width, goldLayer.height);
    const basinDone = completed.has('strip_basin');
    const deckDone = completed.has('strip_deck');

    if (!deckDone) {
      const deckGold = goldCtx.createLinearGradient(g.deck.x, g.deck.y, g.deck.x + g.deck.w, g.deck.y + g.deck.h);
      deckGold.addColorStop(0, '#73510d');
      deckGold.addColorStop(0.25, '#f1c84a');
      deckGold.addColorStop(0.52, '#fff0a0');
      deckGold.addColorStop(0.78, '#bd7d16');
      deckGold.addColorStop(1, '#e9b62e');
      goldCtx.fillStyle = deckGold;
      goldCtx.fillRect(g.deck.x, g.deck.y, g.deck.w, g.deck.h);
    }

    if (!basinDone) {
      const gold = goldCtx.createLinearGradient(g.pool.cx - g.pool.rx, g.pool.cy - g.pool.ry, g.pool.cx + g.pool.rx, g.pool.cy + g.pool.ry);
      gold.addColorStop(0, '#724407');
      gold.addColorStop(0.2, '#e4ad2d');
      gold.addColorStop(0.48, '#fff2a8');
      gold.addColorStop(0.68, '#b96f0e');
      gold.addColorStop(1, '#f6cd4e');
      goldCtx.fillStyle = gold;
      goldCtx.beginPath();
      goldCtx.ellipse(g.pool.cx, g.pool.cy, g.pool.rx, g.pool.ry, 0, 0, Math.PI * 2);
      goldCtx.fill();
    }

    goldCtx.save();
    goldCtx.globalCompositeOperation = 'destination-out';
    for (const stroke of peelStrokes) {
      if (stroke.zone === 'basin' && basinDone) continue;
      if (stroke.zone === 'deck' && deckDone) continue;
      const grad = goldCtx.createRadialGradient(stroke.x, stroke.y, stroke.r * 0.32, stroke.x, stroke.y, stroke.r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.72, 'rgba(0,0,0,0.92)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      goldCtx.fillStyle = grad;
      goldCtx.beginPath();
      goldCtx.arc(stroke.x, stroke.y, stroke.r, 0, Math.PI * 2);
      goldCtx.fill();
    }
    goldCtx.restore();
  }

  function renderVanity(ctx, w, h, state, step, completed, time) {
    const g = geometry();
    const cleaned = completed.has('restore_glamour_vanity');
    const receiptFound = completed.has('safe_receipt_clue');

    const wall = ctx.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, '#211324');
    wall.addColorStop(0.58, '#14121a');
    wall.addColorStop(1, '#090b0f');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);

    const mirrorX = w * 0.27;
    const mirrorY = h * 0.12;
    const mirrorW = w * 0.46;
    const mirrorH = h * 0.48;
    ctx.fillStyle = '#090d12';
    ctx.fillRect(mirrorX - 18, mirrorY - 18, mirrorW + 36, mirrorH + 36);
    ctx.strokeStyle = '#7c5a79';
    ctx.lineWidth = 4;
    ctx.strokeRect(mirrorX - 18, mirrorY - 18, mirrorW + 36, mirrorH + 36);

    const mirror = ctx.createLinearGradient(mirrorX, mirrorY, mirrorX + mirrorW, mirrorY + mirrorH);
    mirror.addColorStop(0, '#314756');
    mirror.addColorStop(0.5, '#161e28');
    mirror.addColorStop(1, '#51344f');
    ctx.fillStyle = mirror;
    ctx.fillRect(mirrorX, mirrorY, mirrorW, mirrorH);

    for (let i = 0; i < 12; i += 1) {
      const left = i < 6;
      const j = i % 6;
      const x = left ? mirrorX - 10 : mirrorX + mirrorW + 10;
      const y = mirrorY + 20 + j * ((mirrorH - 40) / 5);
      ctx.fillStyle = `rgba(255,220,160,${0.65 + Math.sin(time * 0.004 + i) * 0.18})`;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#4a303f';
    ctx.fillRect(g.vanity.x, g.vanity.y, g.vanity.w, g.vanity.h);
    const cleanAlpha = Math.max(vanityClean, cleaned ? 1 : 0);
    ctx.fillStyle = `rgba(205,190,183,${0.25 + cleanAlpha * 0.55})`;
    ctx.fillRect(g.vanity.x + 8, g.vanity.y + 10, g.vanity.w - 16, g.vanity.h - 20);

    if (!cleaned) {
      ctx.strokeStyle = `rgba(230,196,178,${0.34 * (1 - cleanAlpha)})`;
      ctx.lineWidth = 8;
      for (let i = 0; i < 7; i += 1) {
        ctx.beginPath();
        ctx.moveTo(mirrorX + 40 + i * 45, mirrorY + 35 + (i % 3) * 12);
        ctx.quadraticCurveTo(mirrorX + 70 + i * 38, mirrorY + mirrorH * 0.55, mirrorX + 45 + i * 45, mirrorY + mirrorH - 25);
        ctx.stroke();
      }
    }

    for (const item of vanityTrash) {
      if (!item.alive) continue;
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rot);
      ctx.fillStyle = '#e879f9';
      ctx.fillRect(-item.w / 2, -item.h / 2, item.w, item.h);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(-2, -item.h, 4, item.h * 2);
      ctx.restore();
    }

    const safeX = w * 0.55;
    const safeY = h * 0.27;
    const safeW = w * 0.19;
    const safeH = h * 0.27;
    if (cleaned || cleanAlpha > 0.75) {
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(safeX, safeY, safeW, safeH);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(34,211,238,0.12)';
      ctx.fillRect(safeX, safeY, safeW, safeH);
      drawSafeDoor(ctx, safeX, safeY, safeW, safeH, safeOpen);
    }

    if (receiptFound || safeOpen > 0.46) drawReceipts(ctx, safeX + safeW * 0.47, safeY + safeH * 0.53);

    ctx.fillStyle = 'rgba(2,8,12,0.88)';
    ctx.fillRect(w * 0.08, h * 0.14, 105, 38);
    ctx.strokeStyle = '#f472b6';
    ctx.strokeRect(w * 0.08, h * 0.14, 105, 38);
    ctx.fillStyle = '#fbcfe8';
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ZONE 02 // VANITY', w * 0.08 + 52.5, h * 0.14 + 23);

    if (step?.id === 'safe_receipt_clue') {
      ctx.fillStyle = '#cffafe';
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.fillText('PRESS E TO OPEN THE EXPOSED SAFE', w * 0.5, h * 0.88);
    }
  }

  function drawSafeDoor(ctx, x, y, w, h, open) {
    ctx.fillStyle = '#121820';
    ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
    ctx.save();
    ctx.translate(x, y);
    const sx = Math.max(0.08, 1 - open * 0.82);
    ctx.transform(sx, 0, open * -0.16, 1, 0, 0);
    const door = ctx.createLinearGradient(0, 0, w, h);
    door.addColorStop(0, '#69737e');
    door.addColorStop(1, '#1f2937');
    ctx.fillStyle = door;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.beginPath();
    ctx.arc(w * 0.68, h * 0.5, Math.min(w, h) * 0.13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawReceipts(ctx, cx, cy) {
    for (let i = 0; i < 4; i += 1) {
      ctx.save();
      ctx.translate(cx + i * 10, cy + i * 5);
      ctx.rotate(-0.09 + i * 0.035);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-34, -46, 68, 92);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-25, -30, 46, 4);
      ctx.fillRect(-25, -18, 38, 3);
      ctx.fillRect(-25, -7, 43, 3);
      ctx.fillStyle = '#ef4444';
      ctx.font = '700 8px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('48H RENTAL', -24, 29);
      ctx.fillText('$0 OWNED', -24, 40);
      ctx.restore();
    }
  }

  function drawGame1BrushHUD(ctx, state, step, basinDone, deckDone) {
    if (!step || step.kind !== 'core_action') return;
    const spec = visualSpec(state, step.id);
    let ratio = 0;
    if (step.id === 'strip_basin') ratio = basinDone ? 1 : coverage.basin.size / Math.max(1, targetTotals.basin);
    else if (step.id === 'strip_deck') ratio = deckDone ? 1 : coverage.deck.size / Math.max(1, targetTotals.deck);
    else if (step.id === 'restore_glamour_vanity') ratio = vanityClean;
    else if (step.id === 'collect_debris') ratio = debris.filter((d) => !d.alive).length / debris.length;
    else return;

    ctx.fillStyle = 'rgba(3,8,13,0.86)';
    ctx.fillRect(canvas.width * 0.31, canvas.height * 0.11, canvas.width * 0.38, 33);
    ctx.strokeStyle = '#0e7490';
    ctx.strokeRect(canvas.width * 0.31, canvas.height * 0.11, canvas.width * 0.38, 33);
    ctx.fillStyle = '#164e63';
    ctx.fillRect(canvas.width * 0.33, canvas.height * 0.11 + 13, canvas.width * 0.27, 8);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(canvas.width * 0.33, canvas.height * 0.11 + 13, canvas.width * 0.27 * Math.min(1, ratio), 8);
    ctx.fillStyle = '#cffafe';
    ctx.font = '700 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(ratio * 100)}% / ${Math.round((spec.completion_threshold ?? 0.55) * 100)}% REQUIRED`, canvas.width * 0.615, canvas.height * 0.11 + 21);
  }

  function renderReturnToSender(ctx, w, h, state, stepId, time) {
    ctx.fillStyle = '#22252a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(0, 0, 140, h);
    ctx.fillRect(w - 140, 0, 140, h);
    ctx.fillStyle = '#181a1e';
    ctx.fillRect(150, 40, w - 300, h - 80);
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(w * 0.35, 40, w * 0.3, 80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOGISTICS COMPACTOR', w * 0.5, 85);
    const stepCount = state.completed_step_ids?.length || 0;
    const remainingParcels = Math.max(0, 6 - stepCount);
    for (let i = 0; i < remainingParcels; i++) {
      const px = 220 + (i % 3) * 140;
      const py = 200 + Math.floor(i / 3) * 100;
      ctx.fillStyle = i === 1 ? '#e74c3c' : '#d35400';
      ctx.fillRect(px, py, 90, 70);
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(px + 10, py + 25, 70, 8);
    }
    if (state.events.some(e => e.event === 'signature_reveal_seen')) {
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(w * 0.25, h * 0.65, w * 0.5, 60);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.fillText('FAILED RECURRING SUBSCRIPTION DETECTED (RECIPIENT #417)', w * 0.5, h * 0.65 + 35);
    }
  }

  function renderThemePark(ctx, w, h, state, stepId, time) {
    ctx.fillStyle = '#1c152b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#34234f';
    ctx.fillRect(40, 60, 160, h - 120);
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = '#ff7675';
      ctx.beginPath();
      ctx.arc(120, 110 + i * 80, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#110c1c';
    ctx.fillRect(240, 60, w - 280, h - 120);
    const isShowRunning = state.completed_step_ids?.includes('run_show') || stepId.includes('show');
    const angle = isShowRunning ? (time * 0.002) : 0;
    ctx.save();
    ctx.translate(w * 0.62, h * 0.5);
    ctx.rotate(angle);
    ctx.fillStyle = '#a29bfe';
    ctx.fillRect(-60, -60, 120, 120);
    ctx.fillStyle = '#fdcb6e';
    ctx.beginPath();
    ctx.arc(0, 0, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (isShowRunning) {
      ctx.fillStyle = 'rgba(255, 234, 167, 0.2)';
      ctx.beginPath();
      ctx.moveTo(w * 0.62, 60);
      ctx.lineTo(w * 0.4, h - 60);
      ctx.lineTo(w * 0.85, h - 60);
      ctx.fill();
    }
  }

  function renderCursedSecondhand(ctx, w, h, state, stepId, time) {
    ctx.fillStyle = '#181512';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3d2e1e';
    ctx.fillRect(60, 40, w - 120, h - 80);
    const cx = w * 0.5, cy = h * 0.48;
    ctx.fillStyle = '#1e140d';
    ctx.fillRect(cx - 90, cy - 130, 180, 260);
    const isReveal = state.events.some(e => e.event === 'signature_reveal_seen') || stepId.includes('reveal');
    if (!isReveal) {
      ctx.fillStyle = '#e8d8b5';
      ctx.beginPath();
      ctx.arc(cx, cy - 30, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2c1e13';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 30);
      ctx.lineTo(cx + 35, cy - 10);
      ctx.moveTo(cx, cy - 30);
      ctx.lineTo(cx - 20, cy - 65);
      ctx.stroke();
    } else {
      const portalGrad = ctx.createRadialGradient(cx, cy - 30, 5, cx, cy - 30, 70);
      portalGrad.addColorStop(0, '#6c5ce7');
      portalGrad.addColorStop(0.6, '#a29bfe');
      portalGrad.addColorStop(1, '#000');
      ctx.fillStyle = portalGrad;
      ctx.beginPath();
      ctx.arc(cx, cy - 30, 65, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('1924 MEMORY SPACE', cx, cy - 25);
    }
  }

  function renderPawnshop(ctx, w, h, state, stepId, time) {
    ctx.fillStyle = '#0f141c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1e3799';
    ctx.fillRect(100, 80, w - 200, h - 160);
    ctx.fillStyle = 'rgba(106, 176, 76, 0.15)';
    ctx.fillRect(100, 80, w - 200, h - 160);
    const items = ['Vintage Watch', 'Signed Guitar', 'Gold Coin'];
    for (let i = 0; i < 3; i++) {
      const ix = 180 + i * 200;
      const iy = h * 0.45;
      ctx.fillStyle = '#f6b93b';
      ctx.fillRect(ix, iy, 120, 90);
      ctx.fillStyle = '#0a3d62';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(items[i], ix + 60, iy + 45);
      ctx.fillStyle = 'rgba(74, 105, 189, 0.8)';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('[UV CHECKED]', ix + 60, iy + 70);
    }
  }

  function updateHUD(state) {
    const totalSteps = state.scenario?.steps?.length || 6;
    const completedCount = state.completed_step_ids?.length || 0;
    const pct = Math.min(100, Math.round((completedCount / totalSteps) * 100));
    const pEl = document.getElementById('progress-val');
    if (pEl) pEl.textContent = `${pct}%`;
    const sEl = document.getElementById('state-val');
    if (sEl) {
      if (state.finished) sEl.textContent = 'COMPLETED';
      else if (state.concept?.concept_id === GAME1) {
        const spec = visualSpec(state, state.current_step?.id);
        sEl.textContent = spec.scene === 'glamour_vanity' ? 'VANITY' : 'GOLD POOL';
      } else sEl.textContent = state.startedAt ? 'ACTIVE' : 'READY';
    }
    const tEl = document.getElementById('concept-title');
    if (tEl && state.concept) tEl.textContent = state.concept.title;
    const timeEl = document.getElementById('time-val');
    if (timeEl) {
      const elapsed = state.startedAt ? Math.max(0, Date.now() - state.startedAt) : 0;
      const sec = Math.floor(elapsed / 1000);
      timeEl.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }
    const prompt = document.getElementById('action-prompt');
    if (prompt && state.concept?.concept_id === GAME1) {
      const step = state.current_step;
      const spec = visualSpec(state, step?.id);
      if (!state.startedAt) prompt.textContent = 'PRESS ENTER TO START MISSION';
      else if (!step) prompt.textContent = 'PRESS ENTER TO COMPLETE MISSION';
      else if (spec.interaction?.startsWith('drag')) prompt.textContent = `DRAG TO ${step.id.includes('strip') ? 'PEEL GOLD' : 'CLEAN'} · SPACE = QA SKIP`;
      else if (step.kind === 'reveal') prompt.textContent = 'PRESS Q TO INSPECT THE BARE SURFACE';
      else if (step.kind === 'inspect') prompt.textContent = 'PRESS E TO INSPECT';
      else if (step.kind === 'choice') prompt.textContent = 'PRESS F TO COMMIT EVIDENCE CHOICE';
      else prompt.textContent = 'CLICK / SPACE TO OPERATE';
    }
  }

  function renderParticles(ctx) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rotation += p.vr;
      p.alpha -= p.fade;
      if (p.alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.kind === 'gold') {
        ctx.beginPath();
        ctx.moveTo(-p.size, -p.size * 0.3);
        ctx.lineTo(p.size * 0.85, -p.size * 0.55);
        ctx.lineTo(p.size, p.size * 0.35);
        ctx.lineTo(-p.size * 0.7, p.size * 0.55);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function spawnParticles(x, y, count, color, kind = 'spark') {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 5 - 1.5,
        size: Math.random() * 4 + 2,
        color,
        alpha: 1,
        fade: 0.025 + Math.random() * 0.018,
        gravity: kind === 'water' ? 0.08 : 0.16,
        rotation: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.25,
        kind,
      });
    }
  }

  function spawnFlakes(x, y, count, color, kind) {
    spawnParticles(x, y, count, color, kind);
  }

  function spawnSpray(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 2.4,
        vy: -1 - Math.random() * 2.2,
        size: 1.5 + Math.random() * 2.5,
        color: '#7dd3fc',
        alpha: 0.8,
        fade: 0.05,
        gravity: 0.06,
        rotation: 0,
        vr: 0,
        kind: 'spray',
      });
    }
  }

  function makeDebris() {
    return Array.from({ length: 14 }, (_, i) => ({
      x: canvas.width * (0.25 + seeded(i + 12) * 0.5),
      y: canvas.height * (0.44 + seeded(i + 42) * 0.25),
      r: 5 + (i % 4) * 1.5,
      alive: true,
    }));
  }

  function makeVanityTrash() {
    const g = geometry();
    return Array.from({ length: 12 }, (_, i) => ({
      x: g.vanity.x + 25 + seeded(i + 72) * (g.vanity.w - 50),
      y: g.vanity.y + 18 + seeded(i + 132) * (g.vanity.h - 36),
      w: 12 + (i % 4) * 5,
      h: 6 + (i % 3) * 4,
      rot: (seeded(i + 190) - 0.5) * 1.5,
      alive: true,
    }));
  }

  function seeded(n) {
    const x = Math.sin(n * 91.113 + 17.31) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawConcreteNoise(ctx, x, y, w, h, intensity) {
    for (let i = 0; i < 65; i += 1) {
      const px = x + seeded(i + 300) * w;
      const py = y + seeded(i + 500) * h;
      ctx.fillStyle = i % 4 === 0 ? `rgba(23,91,59,${0.16 * intensity})` : `rgba(15,20,20,${0.13 * intensity})`;
      ctx.beginPath();
      ctx.arc(px, py, 2 + (i % 5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAlgae(ctx, g, intensity) {
    for (let i = 0; i < 34; i += 1) {
      const a = seeded(i + 700);
      const b = seeded(i + 800);
      ctx.fillStyle = `rgba(20,92,58,${0.18 + 0.3 * intensity})`;
      ctx.beginPath();
      ctx.ellipse(g.pool.cx - g.pool.rx * 0.72 + a * g.pool.rx * 1.44, g.pool.cy - g.pool.ry * 0.62 + b * g.pool.ry * 1.24, 8 + (i % 5) * 4, 4 + (i % 3) * 3, a * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPoolCracks(ctx, g, intensity) {
    ctx.strokeStyle = `rgba(13,16,15,${0.45 + intensity * 0.55})`;
    ctx.lineWidth = 3 + intensity * 2;
    const lines = [
      [[-0.5, -0.35], [-0.28, -0.12], [-0.12, 0.05], [0.08, 0.15], [0.32, 0.38]],
      [[0.42, -0.42], [0.27, -0.14], [0.08, 0.06], [-0.06, 0.42]],
      [[-0.65, 0.31], [-0.35, 0.2], [-0.18, 0.24]],
    ];
    for (const line of lines) {
      ctx.beginPath();
      line.forEach(([nx, ny], i) => {
        const x = g.pool.cx + nx * g.pool.rx;
        const y = g.pool.cy + ny * g.pool.ry;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    if (intensity > 0.65) {
      ctx.fillStyle = '#7c3f1d';
      ctx.fillRect(g.pool.cx + 15, g.pool.cy + 18, 55, 6);
      ctx.fillRect(g.pool.cx + 43, g.pool.cy + 4, 6, 30);
    }
  }

  requestAnimationFrame(loop);
}
