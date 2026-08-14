
import { resolveInput } from '../core/input.js';

let state = null;
let currentConcept = null;
let currentScenario = null;
let particles = [];
let animFrameId = null;

// Audio context synthesizer for tactile effects
let audioCtx = null;
function playSound(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    
    if (type === 'spray') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.15);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'reveal') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.3);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'clue') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {}
}

export function initCanvasRenderer(canvas, getStateFn, dispatchFn) {
  const ctx = canvas.getContext('2d');
  
  // Mouse Interaction (Click/Drag to Clean)
  let isDragging = false;
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    spawnParticles(e.offsetX, e.offsetY, 15, '#e3b341');
    playSound('spray');
    dispatchFn('core_action');
  });
  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      spawnParticles(e.offsetX, e.offsetY, 4, '#58a6ff');
    }
  });
  window.addEventListener('mouseup', () => { isDragging = false; });

  function spawnParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 2,
        size: Math.random() * 5 + 2,
        color,
        alpha: 1,
        life: 1
      });
    }
  }

  function render(time) {
    state = getStateFn();
    if (!state || !state.concept) {
      requestAnimationFrame(render);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Render Environment Background based on current step / state
    const currentStep = state.current_step;
    const stepId = currentStep?.id || 'start';
    const isVanity = stepId.includes('vanity') || stepId.includes('receipt') || currentStep?.area_id === 'glamour_vanity';
    const isDecay = state.events.some(e => e.event === 'signature_reveal_seen') || stepId.includes('reveal');

    if (!isVanity) {
      // Area 1: Luxury Pool Courtyard
      renderPoolArea(ctx, w, h, stepId, isDecay, time);
    } else {
      // Area 2: Glamour Vanity & Hidden Safe
      renderVanityArea(ctx, w, h, stepId, time);
    }

    // 2. Render Animated Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity
      p.alpha -= 0.025;
      if (p.alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Render In-Game HUD Elements
    renderInGameHUD(ctx, w, h, state);

    requestAnimationFrame(render);
  }

  function renderPoolArea(ctx, w, h, stepId, isDecay, time) {
    // Sky / Courtyard Wall
    const gradWall = ctx.createLinearGradient(0, 0, 0, h * 0.4);
    gradWall.addColorStop(0, '#1a1829');
    gradWall.addColorStop(1, '#2d2744');
    ctx.fillStyle = gradWall;
    ctx.fillRect(0, 0, w, h * 0.4);

    // Marble Pillars & Palm Silhouette
    ctx.fillStyle = '#110e1c';
    ctx.fillRect(40, 20, 30, h * 0.38);
    ctx.fillRect(w - 70, 20, 30, h * 0.38);

    // Deck Surface
    const isDeckStripped = stepId.includes('strip_deck') || isDecay;
    ctx.fillStyle = isDeckStripped ? '#3d3835' : '#85754e';
    ctx.fillRect(0, h * 0.4, w, h * 0.6);

    // Gilded Pool Basin
    const poolX = 120, poolY = h * 0.48, poolW = w - 240, poolH = h * 0.44;
    
    // Pool Border (Fake Gold Foil vs Cracked Stone)
    ctx.lineWidth = 14;
    ctx.strokeStyle = isDecay ? '#4a4441' : '#f5d061';
    ctx.strokeRect(poolX, poolY, poolW, poolH);

    // Pool Basin Interior
    const isWaterDrained = stepId !== 'inspect_objective' && stepId !== 'collect_debris' && stepId !== 'start';
    if (!isWaterDrained) {
      // Water present
      const wave = Math.sin(time * 0.003) * 4;
      const waterGrad = ctx.createLinearGradient(poolX, poolY, poolX, poolY + poolH);
      waterGrad.addColorStop(0, '#1ba3c6');
      waterGrad.addColorStop(1, '#0e4e68');
      ctx.fillStyle = waterGrad;
      ctx.fillRect(poolX + 6, poolY + 6 + wave, poolW - 12, poolH - 12);
      
      // Floating Debris
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(poolX + 80, poolY + 40 + wave, 24, 14);
      ctx.fillStyle = '#feca57';
      ctx.fillRect(poolX + 220, poolY + 60 - wave, 18, 18);
    } else {
      // Drained Basin (Bare concrete, slime, cracks, and gold remnants)
      const basinGrad = ctx.createLinearGradient(poolX, poolY, poolX, poolY + poolH);
      if (isDecay) {
        basinGrad.addColorStop(0, '#2c3531');
        basinGrad.addColorStop(0.5, '#1b2421'); // algae dark green
        basinGrad.addColorStop(1, '#111615');
      } else {
        basinGrad.addColorStop(0, '#d4af37'); // Fake gold sprayed
        basinGrad.addColorStop(1, '#aa8c2c');
      }
      ctx.fillStyle = basinGrad;
      ctx.fillRect(poolX + 6, poolY + 6, poolW - 12, poolH - 12);

      // Deep Basin Cracks (Decay)
      if (isDecay) {
        ctx.strokeStyle = '#050707';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(poolX + 100, poolY + 40);
        ctx.lineTo(poolX + 260, poolY + 120);
        ctx.lineTo(poolX + 420, poolY + 90);
        ctx.lineTo(poolX + poolW - 80, poolY + 160);
        ctx.stroke();

        // Exposed Rebar
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(poolX + 280, poolY + 105, 45, 6);
        ctx.fillRect(poolX + 310, poolY + 95, 6, 25);
      }
    }
  }

  function renderVanityArea(ctx, w, h, stepId, time) {
    // Glamour Vanity Room Wallpaper
    ctx.fillStyle = '#221526';
    ctx.fillRect(0, 0, w, h);

    // Floor
    ctx.fillStyle = '#17101b';
    ctx.fillRect(0, h * 0.7, w, h * 0.3);

    // Hollywood Vanity Mirror (Bulbs + Reflection)
    const mirrorX = w * 0.25, mirrorY = 40, mirrorW = w * 0.5, mirrorH = h * 0.58;
    ctx.fillStyle = '#2d1f33';
    ctx.fillRect(mirrorX - 16, mirrorY - 16, mirrorW + 32, mirrorH + 32);

    // Mirror Glass Surface
    const isSafeOpen = stepId.includes('safe') || stepId.includes('receipt') || stepId.includes('disposition');
    if (!isSafeOpen) {
      ctx.fillStyle = '#63536b';
      ctx.fillRect(mirrorX, mirrorY, mirrorW, mirrorH);
      
      // Vanity Lights
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(mirrorX - 8, mirrorY + 30 + i * 48, 7, 0, Math.PI * 2);
        ctx.arc(mirrorX + mirrorW + 8, mirrorY + 30 + i * 48, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Concealed Safe Exposed Behind Mirror!
      ctx.fillStyle = '#1e232a';
      ctx.fillRect(mirrorX, mirrorY, mirrorW, mirrorH);
      
      // Safe Door Swung Open
      ctx.strokeStyle = '#485460';
      ctx.lineWidth = 8;
      ctx.strokeRect(mirrorX + 40, mirrorY + 30, mirrorW - 80, mirrorH - 60);

      // Rental Receipts Stack
      ctx.fillStyle = '#f1f2f6';
      ctx.fillRect(mirrorX + mirrorW * 0.35, mirrorY + mirrorH * 0.4, 80, 50);
      ctx.fillStyle = '#eb2f06';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('RENTAL 48H', mirrorX + mirrorW * 0.35 + 8, mirrorY + mirrorH * 0.4 + 20);
      ctx.fillText('$0 OWNED', mirrorX + mirrorW * 0.35 + 8, mirrorY + mirrorH * 0.4 + 36);
    }
  }

  function renderInGameHUD(ctx, w, h, state) {
    const totalSteps = state.scenario?.steps?.length || 9;
    const completedCount = state.completed_step_ids?.length || 0;
    const pct = Math.min(100, Math.round((completedCount / totalSteps) * 100));

    // Update DOM counters
    const pEl = document.getElementById('progress-val');
    if (pEl) pEl.textContent = pct + '%';
    const sEl = document.getElementById('state-val');
    if (sEl && state.current_step?.transformation?.after) {
      sEl.textContent = state.current_step.transformation.after.slice(0, 18).toUpperCase();
    }
  }

  requestAnimationFrame(render);
}
