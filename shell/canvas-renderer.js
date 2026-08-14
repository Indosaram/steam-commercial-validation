/**
 * Neutral Canvas fallback used when a candidate does not ship game.js or when
 * a candidate module fails to initialize. Candidate-specific rendering belongs
 * in candidates/<concept_id>/game.js, never in shell/.
 */
export default function createBlankGame({ canvas, ctx, overlay, concept, scenario, getState }) {
  let frameId = 0;
  let destroyed = false;

  const draw = (time) => {
    if (destroyed) return;
    const state = getState();
    const { width: w, height: h } = canvas;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(88, 166, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const completed = state.completedSteps?.length ?? 0;
    const total = scenario?.steps?.length ?? 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const pending = scenario?.steps?.find((step) => !state.completedSteps?.includes(step.id));

    ctx.textAlign = 'center';
    ctx.fillStyle = '#58a6ff';
    ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('MODULAR CANVAS HOST', w / 2, h * 0.38);

    ctx.fillStyle = '#c9d1d9';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(concept?.title ?? 'Candidate', w / 2, h * 0.48);

    ctx.fillStyle = '#8b949e';
    ctx.font = '14px system-ui, sans-serif';
    const message = scenario
      ? (pending ? `Pending: ${pending.label ?? pending.id}` : 'All descriptor steps complete')
      : 'No candidate scenario/game module: neutral blank-shell fallback';
    ctx.fillText(message, w / 2, h * 0.56);

    if (scenario) {
      const barX = w * 0.2;
      const barY = h * 0.64;
      const barW = w * 0.6;
      ctx.fillStyle = '#21262d';
      ctx.fillRect(barX, barY, barW, 12);
      ctx.fillStyle = '#2f81f7';
      ctx.fillRect(barX, barY, barW * (pct / 100), 12);
      ctx.fillStyle = '#8b949e';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(`${pct}% descriptor progress`, w / 2, barY + 34);
    }

    const pulse = 0.65 + Math.sin(time * 0.003) * 0.2;
    ctx.fillStyle = `rgba(88, 166, 255, ${pulse})`;
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('Candidate graphics are isolated in /candidate/game.js', w / 2, h * 0.82);

    if (overlay) {
      const prompt = overlay.querySelector('#action-prompt');
      if (prompt) {
        if (!state.startedAt) prompt.textContent = 'PRESS ENTER TO START MISSION';
        else if (state.finished) prompt.textContent = 'SESSION COMPLETE';
        else if (pending) prompt.textContent = pending.prompt ?? `NEXT: ${pending.label ?? pending.id}`;
        else prompt.textContent = 'PRESS ENTER TO COMPLETE';
      }
    }

    frameId = requestAnimationFrame(draw);
  };

  frameId = requestAnimationFrame(draw);

  return {
    handleVerb() { return false; },
    handlePlayerAction() { return false; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frameId);
    },
    getDebugState() {
      return {
        kind: 'blank_shell',
        running: !destroyed,
        scenario_steps: scenario?.steps?.length ?? 0,
      };
    },
  };
}
