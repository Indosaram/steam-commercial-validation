
let audioCtx = null;
function playSound(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'scrape') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'stage_up') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'clue') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.setValueAtTime(659, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {}
}

export function initCanvasRenderer(canvas, getStateFn, dispatchFn) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Offscreen Scratch/Peeling Mask Canvases
  const goldCanvas = document.createElement('canvas');
  goldCanvas.width = w;
  goldCanvas.height = h;
  const goldCtx = goldCanvas.getContext('2d');

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = w;
  rotCanvas.height = h;
  const rotCtx = rotCanvas.getContext('2d');

  let currentRenderState = '';
  let particles = [];
  let isPointerDown = false;
  let scratchedPixels = 0;
  let totalMaskPixels = 1;
  let currentPeelPct = 0;
  let lastPos = { x: 0, y: 0 };

  // Generate Base Layers for Pool Basin & Deck
  function buildLayers(state, stepId) {
    const isVanity = stepId.includes('vanity') || stepId.includes('receipt') || state.completed_step_ids?.includes('restore_glamour_vanity');
    
    // 1. Generate Rotten Substrate (Rot Layer)
    rotCtx.clearRect(0, 0, w, h);
    if (!isVanity) {
      // Moldy, algae-stained, cracked dark concrete
      const rGrad = rotCtx.createLinearGradient(100, h * 0.45, w - 100, h * 0.95);
      rGrad.addColorStop(0, '#151d1a'); // slimy dark green/black
      rGrad.addColorStop(0.5, '#0e1412');
      rGrad.addColorStop(1, '#2b1d14'); // stained rust
      rotCtx.fillStyle = rGrad;
      rotCtx.fillRect(100, h * 0.48, w - 200, h * 0.44);

      // Deep Structural Cracks
      rotCtx.strokeStyle = '#040706';
      rotCtx.lineWidth = 4;
      rotCtx.beginPath();
      rotCtx.moveTo(120, h * 0.52);
      rotCtx.lineTo(340, h * 0.72);
      rotCtx.lineTo(520, h * 0.62);
      rotCtx.lineTo(w - 140, h * 0.82);
      rotCtx.stroke();

      // Exposed Corroded Rebar
      rotCtx.fillStyle = '#8b3e10';
      rotCtx.fillRect(360, h * 0.68, 80, 8);
      rotCtx.fillRect(400, h * 0.65, 8, 30);

      // Warning Stencil Text underneath
      rotCtx.fillStyle = '#eb4d4b';
      rotCtx.font = 'bold 16px monospace';
      rotCtx.fillText('CONDEMNED: STRUCTURAL FAILURE CONCEALED', 180, h * 0.88);
    } else {
      // Vanity Hidden Safe Rot / Evidence Layer
      rotCtx.fillStyle = '#111418';
      rotCtx.fillRect(w * 0.28, 40, w * 0.44, h * 0.6);
      
      // Safe Door Open
      rotCtx.strokeStyle = '#57606f';
      rotCtx.lineWidth = 6;
      rotCtx.strokeRect(w * 0.32, 70, w * 0.36, h * 0.48);

      // Rental Invoices Stack
      rotCtx.fillStyle = '#f1f2f6';
      rotCtx.fillRect(w * 0.38, h * 0.3, 180, 100);
      rotCtx.fillStyle = '#ff3838';
      rotCtx.font = 'bold 14px monospace';
      rotCtx.fillText('PROP RENTAL INVOICE', w * 0.38 + 12, h * 0.3 + 28);
      rotCtx.fillStyle = '#2f3542';
      rotCtx.font = '11px monospace';
      rotCtx.fillText('Gold Paint: 24h Hire', w * 0.38 + 12, h * 0.3 + 52);
      rotCtx.fillText('Mansion: 48h Staged Lease', w * 0.38 + 12, h * 0.3 + 70);
      rotCtx.fillStyle = '#eb2f06';
      rotCtx.font = 'bold 12px monospace';
      rotCtx.fillText('TOTAL OWNED: $0.00', w * 0.38 + 12, h * 0.3 + 90);
    }

    // 2. Generate Pristine Fake Gold Foil (Gold Layer)
    goldCtx.clearRect(0, 0, w, h);
    if (!isVanity) {
      // Glittering Fake Gold Coating
      const gGrad = goldCtx.createLinearGradient(100, h * 0.48, w - 100, h * 0.92);
      gGrad.addColorStop(0, '#f9ca24');
      gGrad.addColorStop(0.3, '#f6e58d'); // shiny metallic shine
      gGrad.addColorStop(0.7, '#e0a800');
      gGrad.addColorStop(1, '#b78103');
      goldCtx.fillStyle = gGrad;
      goldCtx.fillRect(100, h * 0.48, w - 200, h * 0.44);

      // Gold Tile Grid Pattern
      goldCtx.strokeStyle = 'rgba(255,255,255,0.4)';
      goldCtx.lineWidth = 1;
      for (let x = 100; x < w - 100; x += 40) {
        goldCtx.beginPath();
        goldCtx.moveTo(x, h * 0.48);
        goldCtx.lineTo(x, h * 0.92);
        goldCtx.stroke();
      }
      for (let y = h * 0.48; y < h * 0.92; y += 40) {
        goldCtx.beginPath();
        goldCtx.moveTo(100, y);
        goldCtx.lineTo(w - 100, y);
        goldCtx.stroke();
      }
    } else {
      // Glamour Mirror Surface with Hollywood Lights
      goldCtx.fillStyle = '#747d8c';
      goldCtx.fillRect(w * 0.28, 40, w * 0.44, h * 0.6);

      goldCtx.fillStyle = '#dfe4ea';
      goldCtx.fillRect(w * 0.32, 60, w * 0.36, h * 0.52);

      goldCtx.fillStyle = '#ffa502';
      goldCtx.font = 'bold 16px -apple-system, sans-serif';
      goldCtx.fillText('GLAMOUR BEAUTY VANITY', w * 0.36, h * 0.35);
      goldCtx.fillStyle = '#747d8c';
      goldCtx.font = '12px sans-serif';
      goldCtx.fillText('(Drag to strip vanity coating)', w * 0.37, h * 0.42);
    }

    scratchedPixels = 0;
    currentPeelPct = 0;
    totalMaskPixels = (w - 200) * (h * 0.44);
  }

  // Real-Time Scratch / Peel Off Action
  function scratchAt(x, y, radius = 34) {
    goldCtx.globalCompositeOperation = 'destination-out';
    goldCtx.beginPath();
    goldCtx.arc(x, y, radius, 0, Math.PI * 2);
    goldCtx.fill();
    goldCtx.globalCompositeOperation = 'source-over';

    // Spawn gold peel particles
    spawnPeelFlakes(x, y, 6);
    playSound('scrape');

    scratchedPixels += Math.PI * radius * radius * 0.35;
    currentPeelPct = Math.min(100, Math.round((scratchedPixels / (totalMaskPixels * 0.4)) * 100));

    // Update Live HUD
    const pEl = document.getElementById('progress-val');
    if (pEl) pEl.textContent = `${currentPeelPct}% PEELED`;

    // Auto-advance step when enough is peeled
    if (currentPeelPct >= 65) {
      playSound('stage_up');
      scratchedPixels = 0;
      dispatchFn('core_action');
    }
  }

  function spawnPeelFlakes(x, y, count) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 5 - 2,
        size: Math.random() * 6 + 3,
        color: Math.random() > 0.3 ? '#f9ca24' : '#f6e58d',
        alpha: 1,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.2
      });
    }
  }

  // Mouse & Touch Physical Event Listeners
  canvas.addEventListener('mousedown', (e) => {
    isPointerDown = true;
    lastPos = { x: e.offsetX, y: e.offsetY };
    scratchAt(e.offsetX, e.offsetY, 36);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isPointerDown) return;
    const dx = e.offsetX - lastPos.x;
    const dy = e.offsetY - lastPos.y;
    const dist = Math.hypot(dx, dy);
    
    // Interpolate points for smooth peeling
    const steps = Math.ceil(dist / 12);
    for (let i = 0; i <= steps; i++) {
      const ix = lastPos.x + (dx * i) / steps;
      const iy = lastPos.y + (dy * i) / steps;
      scratchAt(ix, iy, 32);
    }
    lastPos = { x: e.offsetX, y: e.offsetY };
  });

  window.addEventListener('mouseup', () => { isPointerDown = false; });

  // Main Render Loop
  function loop(time) {
    const state = getStateFn();
    ctx.clearRect(0, 0, w, h);

    if (!state || !state.concept) {
      requestAnimationFrame(loop);
      return;
    }

    const stepId = state.current_step?.id || state.completed_step_ids?.slice(-1)[0] || 'start';
    const stateKey = `${state.concept.concept_id}_${stepId}`;

    if (currentRenderState !== stateKey) {
      currentRenderState = stateKey;
      buildLayers(state, stepId);
    }

    // 1. Draw Background Environment (Villa Wall, Palm Trees, Sky)
    drawEnvironment(ctx, w, h, state);

    // 2. Composite Rot Layer (Underneath)
    ctx.drawImage(rotCanvas, 0, 0);

    // 3. Composite Gold Mask Layer (Scratched/Peeled Top)
    ctx.drawImage(goldCanvas, 0, 0);

    // 4. Draw Particles (Flying Gold Foil Flakes)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25; // gravity
      p.rot += p.vrot;
      p.alpha -= 0.02;
      if (p.alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }

    // 5. Draw Crosshair / Peeling Tool Cursor
    if (isPointerDown) {
      ctx.save();
      ctx.strokeStyle = '#f9ca24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lastPos.x, lastPos.y, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Sync HUD & Stats
    updateHUD(state, currentPeelPct);

    requestAnimationFrame(loop);
  }

  function drawEnvironment(ctx, w, h, state) {
    // Luxury Villa Architecture
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    skyGrad.addColorStop(0, '#130f1c');
    skyGrad.addColorStop(1, '#251c36');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h * 0.45);

    // Architectural Pillars
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(40, 20, 30, h * 0.43);
    ctx.fillRect(w - 70, 20, 30, h * 0.43);

    // Deck Surrounding Pool
    ctx.fillStyle = '#53463a';
    ctx.fillRect(0, h * 0.45, w, h * 0.55);

    // Pool Stone Rim
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#2d3436';
    ctx.strokeRect(92, h * 0.47, w - 184, h * 0.46);
  }

  function updateHUD(state, peelPct) {
    const sEl = document.getElementById('state-val');
    if (sEl) sEl.textContent = state.finished ? 'COMPLETED' : (state.startedAt ? 'CLEANING ACTIVE' : 'READY');

    const promptEl = document.getElementById('action-prompt');
    if (promptEl) {
      if (!state.startedAt) {
        promptEl.textContent = 'PRESS ENTER TO START MISSION';
      } else if (state.finished) {
        promptEl.textContent = 'MISSION COMPLETE! PRESS R TO RESET';
      } else {
        promptEl.textContent = 'DRAG MOUSE OVER GOLD SURFACE TO PEEL FOIL';
      }
    }
  }

  requestAnimationFrame(loop);
}
