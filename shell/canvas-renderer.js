
let audioCtx = null;
function playFx(freq, type = 'sine', dur = 0.15) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

export function initCanvasRenderer(canvas, getStateFn, dispatchFn) {
  const ctx = canvas.getContext('2d');
  let particles = [];
  let isDown = false;

  canvas.addEventListener('mousedown', (e) => {
    isDown = true;
    spawnParticles(e.offsetX, e.offsetY, 20, '#e3b341');
    playFx(320, 'sawtooth', 0.12);
    dispatchFn('core_action');
  });

  window.addEventListener('mouseup', () => { isDown = false; });
  canvas.addEventListener('mousemove', (e) => {
    if (isDown) spawnParticles(e.offsetX, e.offsetY, 3, '#58a6ff');
  });

  function spawnParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 2,
        size: Math.random() * 4 + 2,
        color,
        alpha: 1
      });
    }
  }

  function loop(time) {
    const state = getStateFn();
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!state || !state.concept) {
      // Standby / Boot Screen
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
    const isFinished = state.finished;

    // Draw Candidate-Specific 2D Graphic Scene
    if (cid === 'fake_it_till_you_clean_it') {
      renderFakeIt(ctx, w, h, state, stepId, time);
    } else if (cid === 'return_to_sender') {
      renderReturnToSender(ctx, w, h, state, stepId, time);
    } else if (cid === 'theme_park_liquidation') {
      renderThemePark(ctx, w, h, state, stepId, time);
    } else if (cid === 'cursed_secondhand') {
      renderCursedSecondhand(ctx, w, h, state, stepId, time);
    } else if (cid === 'panic_at_the_pawnshop') {
      renderPawnshop(ctx, w, h, state, stepId, time);
    }

    // Render Particle Systems
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.alpha -= 0.03;
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

    // Sync HUD Elements
    updateHUD(state);

    requestAnimationFrame(loop);
  }

  // 1. GAME 1: FAKE IT TILL YOU CLEAN IT
  function renderFakeIt(ctx, w, h, state, stepId, time) {
    const isVanity = stepId.includes('vanity') || stepId.includes('receipt') || state.completed_step_ids?.includes('restore_glamour_vanity');
    const isDecay = state.events.some(e => e.event === 'signature_reveal_seen') || stepId.includes('reveal');

    if (!isVanity) {
      // Gold Pool Courtyard Scene
      ctx.fillStyle = '#1e1b2e';
      ctx.fillRect(0, 0, w, h * 0.45);
      
      // Palm Silhouettes & Gilded Fence
      ctx.fillStyle = '#141220';
      ctx.fillRect(50, 30, 25, h * 0.4);
      ctx.fillRect(w - 75, 30, 25, h * 0.4);

      // Deck
      ctx.fillStyle = isDecay ? '#3d3835' : '#85754e';
      ctx.fillRect(0, h * 0.45, w, h * 0.55);

      // Pool Basin
      const px = 100, py = h * 0.5, pw = w - 200, ph = h * 0.42;
      ctx.lineWidth = 14;
      ctx.strokeStyle = isDecay ? '#4a4441' : '#f5d061';
      ctx.strokeRect(px, py, pw, ph);

      const isDrained = stepId !== 'inspect_objective' && stepId !== 'collect_debris' && state.completed_step_ids?.length > 1;
      if (!isDrained) {
        // Water with floating party garbage
        const wave = Math.sin(time * 0.003) * 5;
        const grad = ctx.createLinearGradient(px, py, px, py + ph);
        grad.addColorStop(0, '#00b4d8');
        grad.addColorStop(1, '#0077b6');
        ctx.fillStyle = grad;
        ctx.fillRect(px + 7, py + 7 + wave, pw - 14, ph - 14);

        ctx.fillStyle = '#ff4757';
        ctx.fillRect(px + 120, py + 50 + wave, 28, 16);
        ctx.fillStyle = '#ffd32a';
        ctx.fillRect(px + 280, py + 70 - wave, 20, 20);
      } else {
        // Exposed Rot / Mold / Concrete
        ctx.fillStyle = isDecay ? '#1e2421' : '#d4af37';
        ctx.fillRect(px + 7, py + 7, pw - 14, ph - 14);

        if (isDecay) {
          ctx.strokeStyle = '#050707';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(px + 80, py + 40);
          ctx.lineTo(px + 280, py + 120);
          ctx.lineTo(px + pw - 60, py + 80);
          ctx.stroke();

          ctx.fillStyle = '#8b4513';
          ctx.fillRect(px + 300, py + 100, 50, 6);
        }
      }
    } else {
      // Glamour Vanity & Hidden Safe Scene
      ctx.fillStyle = '#2c1d30';
      ctx.fillRect(0, 0, w, h);

      const mx = w * 0.28, my = 40, mw = w * 0.44, mh = h * 0.6;
      ctx.fillStyle = '#16101a';
      ctx.fillRect(mx - 15, my - 15, mw + 30, mh + 30);

      const isSafeOpen = stepId.includes('receipt') || state.completed_step_ids?.includes('safe_receipt_clue');
      ctx.fillStyle = isSafeOpen ? '#111418' : '#705c78';
      ctx.fillRect(mx, my, mw, mh);

      if (isSafeOpen) {
        ctx.fillStyle = '#f1f2f6';
        ctx.fillRect(mx + mw * 0.35, my + mh * 0.35, 90, 60);
        ctx.fillStyle = '#ff3838';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('RENTAL 48H', mx + mw * 0.35 + 10, my + mh * 0.35 + 25);
        ctx.fillText('$0 OWNED', mx + mw * 0.35 + 10, my + mh * 0.35 + 45);
      }
    }
  }

  // 2. GAME 2: RETURN TO SENDER
  function renderReturnToSender(ctx, w, h, state, stepId, time) {
    // Industrial Delivery Alley
    ctx.fillStyle = '#22252a';
    ctx.fillRect(0, 0, w, h);

    // Brick Walls
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(0, 0, 140, h);
    ctx.fillRect(w - 140, 0, 140, h);

    // Conveyor / Alley Path
    ctx.fillStyle = '#181a1e';
    ctx.fillRect(150, 40, w - 300, h - 80);

    // Compactor Machine at top
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(w * 0.35, 40, w * 0.3, 80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOGISTICS COMPACTOR', w * 0.5, 85);

    // Parcels Stacked
    const stepCount = state.completed_step_ids?.length || 0;
    const remainingParcels = Math.max(0, 6 - stepCount);
    for (let i = 0; i < remainingParcels; i++) {
      const px = 220 + (i % 3) * 140;
      const py = 200 + Math.floor(i / 3) * 100;
      ctx.fillStyle = i === 1 ? '#e74c3c' : '#d35400'; // Fragile Red vs Normal Cardboard
      ctx.fillRect(px, py, 90, 70);
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(px + 10, py + 25, 70, 8); // barcode tape
    }

    if (state.events.some(e => e.event === 'signature_reveal_seen')) {
      // Reveal Recurring Recipient Notice
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(w * 0.25, h * 0.65, w * 0.5, 60);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.fillText('FAILED RECURRING SUBSCRIPTION DETECTED (RECIPIENT #417)', w * 0.5, h * 0.65 + 35);
    }
  }

  // 3. GAME 3: THEME PARK LIQUIDATION
  function renderThemePark(ctx, w, h, state, stepId, time) {
    // Sealed Souvenir Shop & Parade Bay
    ctx.fillStyle = '#1c152b';
    ctx.fillRect(0, 0, w, h);

    // Merch Shelves (Left)
    ctx.fillStyle = '#34234f';
    ctx.fillRect(40, 60, 160, h - 120);

    // Mascot Plushies
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#ff7675';
      ctx.beginPath();
      ctx.arc(120, 110 + i * 80, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Parade Float Bay (Center)
    ctx.fillStyle = '#110c1c';
    ctx.fillRect(240, 60, w - 280, h - 120);

    // Animatronic Mascot Turntable
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
      // Stage Lights Active
      ctx.fillStyle = 'rgba(255, 234, 167, 0.2)';
      ctx.beginPath();
      ctx.moveTo(w * 0.62, 60);
      ctx.lineTo(w * 0.4, h - 60);
      ctx.lineTo(w * 0.85, h - 60);
      ctx.fill();
    }
  }

  // 4. GAME 4: CURSED SECONDHAND
  function renderCursedSecondhand(ctx, w, h, state, stepId, time) {
    // Restorer Workshop Desk
    ctx.fillStyle = '#181512';
    ctx.fillRect(0, 0, w, h);

    // Oak Workbench Surface
    ctx.fillStyle = '#3d2e1e';
    ctx.fillRect(60, 40, w - 120, h - 80);

    // Antique Cursed Clock (Centerpiece)
    const cx = w * 0.5, cy = h * 0.48;
    ctx.fillStyle = '#1e140d';
    ctx.fillRect(cx - 90, cy - 130, 180, 260);

    // Clock Face (Brass & Enamel)
    const isReveal = state.events.some(e => e.event === 'signature_reveal_seen') || stepId.includes('reveal');
    if (!isReveal) {
      ctx.fillStyle = '#e8d8b5';
      ctx.beginPath();
      ctx.arc(cx, cy - 30, 60, 0, Math.PI * 2);
      ctx.fill();

      // Clock Hands frozen at 4:17
      ctx.strokeStyle = '#2c1e13';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 30);
      ctx.lineTo(cx + 35, cy - 10);
      ctx.moveTo(cx, cy - 30);
      ctx.lineTo(cx - 20, cy - 65);
      ctx.stroke();
    } else {
      // Surreal Memory Interior Portal Opened Inside Clock Face!
      const portalGrad = ctx.createRadialGradient(cx, cy - 30, 5, cx, cy - 30, 70);
      portalGrad.addColorStop(0, '#6c5ce7');
      portalGrad.addColorStop(0.6, '#a29bfe');
      portalGrad.addColorStop(1, '#000');
      ctx.fillStyle = portalGrad;
      ctx.beginPath();
      ctx.arc(cx, cy - 30, 65, 0, Math.PI * 2);
      ctx.fill();

      // Memory Silhouette inside portal
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('1924 MEMORY SPACE', cx, cy - 25);
    }
  }

  // 5. GAME 5: PANIC! AT THE PAWNSHOP
  function renderPawnshop(ctx, w, h, state, stepId, time) {
    // Post-Bubble Pawn Counter
    ctx.fillStyle = '#0f141c';
    ctx.fillRect(0, 0, w, h);

    // Velvet Appraisal Tray
    ctx.fillStyle = '#1e3799';
    ctx.fillRect(100, 80, w - 200, h - 160);

    // UV Blacklight Glow Effect
    ctx.fillStyle = 'rgba(106, 176, 76, 0.15)';
    ctx.fillRect(100, 80, w - 200, h - 160);

    // 3 Appraisal Items on Desk
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

      // UV Watermark Stamp
      ctx.fillStyle = 'rgba(74, 105, 189, 0.8)';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('[UV CHECKED]', ix + 60, iy + 70);
    }
  }

  function updateHUD(state) {
    const totalSteps = state.scenario?.steps?.length || 6;
    const completedCount = state.completedSteps?.length || 0;
    const pct = Math.min(100, Math.round((completedCount / totalSteps) * 100));

    const pEl = document.getElementById('progress-val');
    if (pEl) pEl.textContent = pct + '%';
    const sEl = document.getElementById('state-val');
    if (sEl) {
      sEl.textContent = state.finished ? 'COMPLETED' : (state.startedAt ? 'ACTIVE' : 'READY');
    }
    const tEl = document.getElementById('concept-title');
    if (tEl && state.concept) tEl.textContent = state.concept.title;
  }

  requestAnimationFrame(loop);
}
