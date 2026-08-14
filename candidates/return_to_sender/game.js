const COLORS = Object.freeze({
  bg: '#11151b',
  wall: '#252b33',
  asphalt: '#171b20',
  steel: '#414a55',
  steelLight: '#74808d',
  belt: '#25313a',
  cyan: '#67e8f9',
  amber: '#f2b84b',
  orange: '#e57a2e',
  red: '#e35d6a',
  green: '#55c57a',
  paper: '#e8e2d5',
  ink: '#22262b',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const inside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w
  && point.y >= rect.y && point.y <= rect.y + rect.h;
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x
  && a.y < b.y + b.h && a.y + a.h > b.y;

function rectFor(parcel) {
  return { x: parcel.x, y: parcel.y, w: parcel.w, h: parcel.h };
}

function makePanel(title, description) {
  const node = document.createElement('section');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'false');
  node.style.cssText = [
    'position:absolute', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    'width:min(590px,calc(100% - 44px))', 'padding:20px',
    'border:1px solid rgba(103,232,249,.58)', 'border-radius:14px',
    'background:rgba(8,15,21,.96)', 'box-shadow:0 24px 72px rgba(0,0,0,.68)',
    'color:#eefaff', 'font-family:system-ui,sans-serif', 'pointer-events:auto', 'z-index:30',
  ].join(';');
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'margin:0 0 8px;color:#67e8f9;font-size:21px;letter-spacing:.03em';
  const text = document.createElement('p');
  text.textContent = description;
  text.style.cssText = 'margin:0 0 14px;color:#c9d4dc;line-height:1.5';
  node.append(heading, text);
  return { node, heading, text };
}

function makeButton(label, accent = COLORS.cyan) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = [
    `border:1px solid ${accent}`, 'border-radius:8px', 'background:#ffffff10',
    'color:#fff', 'padding:10px 13px', 'font:700 13px system-ui', 'cursor:pointer',
  ].join(';');
  return button;
}

export default function createGame({
  canvas,
  ctx,
  overlay,
  concept,
  scenario,
  getState,
  actions,
  audio,
  toCanvasPoint,
  debug,
}) {
  if (!canvas || !ctx || !scenario) throw new Error('return_to_sender requires canvas, ctx, scenario');

  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  const zones = Object.freeze({
    belt: { x: W * 0.58, y: H * 0.18, w: W * 0.30, h: H * 0.17, label: 'NORMAL → BELT' },
    rack: { x: W * 0.59, y: H * 0.40, w: W * 0.29, h: H * 0.17, label: 'FRAGILE → PADDED RACK' },
    returns: { x: W * 0.58, y: H * 0.63, w: W * 0.30, h: H * 0.19, label: 'RETURN → PALLET' },
    compactor: { x: W * 0.055, y: H * 0.15, w: W * 0.22, h: H * 0.29 },
    leverTrack: { x: W * 0.285, y: H * 0.18, w: W * 0.052, h: H * 0.27 },
    bay: { x: W * 0.055, y: H * 0.64, w: W * 0.25, h: H * 0.22 },
    lane: { x: W * 0.34, y: H * 0.10, w: W * 0.19, h: H * 0.80 },
  });

  const authoredParcels = [
    { id: 'N-104', group: 'normal', label: 'BOOKS', mark: 'NORMAL / BELT', x: W * 0.37, y: H * 0.20 },
    { id: 'N-218', group: 'normal', label: 'FILTERS', mark: 'NORMAL / BELT', x: W * 0.37, y: H * 0.34 },
    { id: 'N-307', group: 'normal', label: 'PAPER STOCK', mark: 'NORMAL / BELT', x: W * 0.37, y: H * 0.48 },
    { id: 'F-019', group: 'fragile', label: 'GLASSWARE', mark: 'FRAGILE / HAND CARRY', x: W * 0.39, y: H * 0.63 },
    { id: 'R-4471-08', group: 'return', label: 'MONTHLY CRATE', mark: 'RETURN / R-4471', x: W * 0.19, y: H * 0.50 },
    { id: 'R-4471-09', group: 'return', label: 'MONTHLY CRATE', mark: 'RETURN / R-4471', x: W * 0.19, y: H * 0.62 },
    { id: 'R-4471-10', group: 'return', label: 'MONTHLY CRATE', mark: 'RETURN / R-4471', x: W * 0.19, y: H * 0.74 },
  ];

  const parcels = authoredParcels.map((parcel) => ({
    ...parcel,
    w: W * 0.145,
    h: H * 0.09,
    homeX: parcel.x,
    homeY: parcel.y,
    targetX: parcel.x,
    targetY: parcel.y,
    placed: false,
    returning: false,
    dragging: false,
    vx: 0,
    vy: 0,
  }));

  const priorityOrder = ['returns', 'normal', 'fragile'];
  const priorityLabels = { returns: 'RETURNS FIRST', normal: 'NORMAL SECOND', fragile: 'FRAGILE LAST' };
  let prioritySelection = [];
  let lastReason = '';
  let lastMissing = [];
  let activePointerId = null;
  let draggedParcel = null;
  let pointerOffset = { x: 0, y: 0 };
  let leverDragging = false;
  let leverPosition = 0;
  let containerDragging = false;
  let containerX = zones.lane.x + W * 0.015;
  let containerY = H * 0.56;
  let containerTargetX = containerX;
  let containerTargetY = containerY;
  let manifestFlashUntil = 0;
  let dispositionOpen = false;
  let destroyed = false;
  let frame = 0;
  let currentSession = null;

  const originalOverlay = overlay ? {
    inset: overlay.style.inset,
    bottom: overlay.style.bottom,
    display: overlay.style.display,
    pointerEvents: overlay.style.pointerEvents,
  } : null;

  if (overlay) {
    overlay.style.inset = '0';
    overlay.style.bottom = '0';
    overlay.style.display = 'block';
    overlay.style.pointerEvents = 'none';
  }

  const briefing = makePanel(
    'MERIDIAN DEPOT 7 // CLEARANCE BRIEFING',
    'Scan alley 7, sort each authored parcel by its printed handling mark, lock a safe routing priority, compact packaging only, and reopen the loading lane.',
  );
  briefing.node.setAttribute('aria-label', 'Return to Sender clearance briefing');
  const briefingButton = makeButton('SCAN OBSTRUCTION (E)');
  briefing.node.append(briefingButton);
  overlay?.append(briefing.node);

  const priorityPanel = makePanel(
    'LOCK PARCEL PRIORITY',
    'Select the safe processing order. A wrong sequence is rejected without destroying any sorted-parcel progress.',
  );
  priorityPanel.node.hidden = true;
  priorityPanel.node.setAttribute('aria-label', 'Parcel priority order');
  const priorityStatus = document.createElement('div');
  priorityStatus.setAttribute('aria-live', 'polite');
  priorityStatus.style.cssText = 'margin:0 0 12px;color:#f2b84b;font:700 12px ui-monospace,monospace';
  const priorityRow = document.createElement('div');
  priorityRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:9px';
  const priorityButtons = {};
  for (const key of priorityOrder) {
    const button = makeButton(priorityLabels[key], key === 'returns' ? COLORS.green : COLORS.cyan);
    button.setAttribute('aria-label', `Choose ${priorityLabels[key].toLowerCase()}`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      choosePriority(key, 'candidate_priority_button');
    });
    priorityButtons[key] = button;
    priorityRow.append(button);
  }
  const resetPriorityButton = makeButton('RESET ORDER', COLORS.amber);
  resetPriorityButton.addEventListener('click', (event) => {
    event.stopPropagation();
    prioritySelection = [];
    lastReason = 'priority_order_reset';
    renderPriorityStatus();
    debug.stateChanged('return_priority_reset', {});
  });
  priorityPanel.node.append(priorityStatus, priorityRow, resetPriorityButton);
  overlay?.append(priorityPanel.node);

  const dispositionPanel = makePanel(
    'RECURRING RECIPIENT DISPOSITION',
    'Choose what happens to the refused R-4471 stack. Your actual selection is written into the shared choice telemetry.',
  );
  dispositionPanel.node.hidden = true;
  dispositionPanel.node.setAttribute('aria-label', 'Recurring recipient disposition');
  const dispositionRow = document.createElement('div');
  dispositionRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:9px';
  const authoredChoices = [
    ['return_to_sender_flagged', 'RETURN + FLAG LOOP'],
    ['hold_at_depot', 'HOLD AT DEPOT'],
    ['reship_unflagged', 'RESHIP UNFLAGGED'],
  ];
  for (const [option, label] of authoredChoices) {
    const button = makeButton(label, option === 'return_to_sender_flagged' ? COLORS.green : COLORS.amber);
    button.setAttribute('aria-label', label);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const result = actions.attemptStep('commit_return_disposition', {
        option,
        decision: option,
        source: 'candidate_disposition_button',
      });
      if (result.ok) {
        dispositionOpen = false;
        dispositionPanel.node.hidden = true;
        audio.tone({ frequency: option === 'return_to_sender_flagged' ? 720 : 520, duration: 0.15, gain: 0.04 });
        debug.stateChanged('return_disposition', { option });
      } else {
        showBlocked(result, 'commit_return_disposition');
      }
    });
    dispositionRow.append(button);
  }
  dispositionPanel.node.append(dispositionRow);
  overlay?.append(dispositionPanel.node);

  const state = () => getState();
  const pending = () => state().pending_step?.id ?? null;
  const completed = (id) => state().completedSteps?.includes(id) ?? false;

  function phase() {
    const current = state();
    if (!current.startedAt || pending() === 'scan_obstruction') return 'briefing';
    const id = pending();
    if (id === 'sort_normal_bulk') return 'normal';
    if (id === 'sort_fragile_divert') return 'fragile';
    if (id === 'sort_return_stack') return 'return';
    if (id === 'priority_order_committed') return 'priority';
    if (id === 'route_compactor') return 'compactor';
    if (id === 'restore_lane_access') return 'lane';
    if (id === 'recurring_recipient_reveal') return 'reveal';
    if (id === 'commit_return_disposition') return 'disposition';
    if (!id && current.scenario && current.completedSteps.length === current.scenario.steps.length) {
      return current.finished ? 'finished' : 'ready_to_finish';
    }
    return 'idle';
  }

  function resetLocalForSession(sessionId) {
    currentSession = sessionId;
    for (const parcel of parcels) {
      parcel.x = parcel.homeX;
      parcel.y = parcel.homeY;
      parcel.targetX = parcel.homeX;
      parcel.targetY = parcel.homeY;
      parcel.placed = false;
      parcel.returning = false;
      parcel.dragging = false;
      parcel.vx = 0;
      parcel.vy = 0;
    }
    prioritySelection = [];
    lastReason = '';
    lastMissing = [];
    leverDragging = false;
    leverPosition = 0;
    containerDragging = false;
    containerX = zones.lane.x + W * 0.015;
    containerY = H * 0.56;
    containerTargetX = containerX;
    containerTargetY = containerY;
    manifestFlashUntil = 0;
    dispositionOpen = false;
    priorityPanel.node.hidden = true;
    dispositionPanel.node.hidden = true;
    briefing.node.hidden = Boolean(sessionId && completed('scan_obstruction'));
  }

  function renderPriorityStatus() {
    const next = priorityOrder[prioritySelection.length];
    const selected = prioritySelection.map((key) => priorityLabels[key]).join(' → ');
    priorityStatus.textContent = selected
      ? `LOCKED SO FAR: ${selected}${next ? ` | NEXT: ${priorityLabels[next]}` : ''}`
      : 'SELECT: RETURNS → NORMAL → FRAGILE';
    for (const key of priorityOrder) priorityButtons[key].disabled = prioritySelection.includes(key);
  }

  function choosePriority(key, source) {
    if (phase() !== 'priority') {
      lastReason = 'priority_ui_not_active';
      audio.tone({ frequency: 170, type: 'square', duration: 0.09, gain: 0.025 });
      return { ok: false, reason: lastReason };
    }
    const expected = priorityOrder[prioritySelection.length];
    if (key !== expected) {
      lastReason = `unsafe_priority_order_expected_${expected}`;
      prioritySelection = [];
      audio.tone({ frequency: 150, type: 'square', duration: 0.12, gain: 0.035 });
      renderPriorityStatus();
      debug.stateChanged('return_priority_rejected', { reason: lastReason });
      return { ok: false, reason: lastReason };
    }
    prioritySelection.push(key);
    audio.tone({ frequency: 420 + prioritySelection.length * 70, type: 'triangle', duration: 0.08, gain: 0.025 });
    renderPriorityStatus();
    debug.stateChanged('return_priority_progress', { selection: [...prioritySelection] });
    if (prioritySelection.length === priorityOrder.length) {
      const result = actions.attemptStep('priority_order_committed', {
        decision: 'returns_first',
        priority_order: [...priorityOrder],
        source,
      });
      if (result.ok) {
        priorityPanel.node.hidden = true;
        lastReason = '';
        audio.tone({ frequency: 680, duration: 0.13, gain: 0.04 });
      } else showBlocked(result, 'priority_order_committed');
      return result;
    }
    return { ok: true, reason: 'priority_partial' };
  }

  function showBlocked(result, stepId) {
    lastMissing = [...(result.missing ?? [])];
    lastReason = result.reason ?? 'blocked';
    audio.tone({ frequency: 145, type: 'square', duration: 0.12, gain: 0.035 });
    debug.stateChanged('return_blocked', {
      step_id: stepId,
      reason: lastReason,
      missing: [...lastMissing],
    });
  }

  function rejectionReason(parcel, targetKey) {
    if (parcel.group === 'normal') return targetKey === 'belt' ? null : 'normal_parcel_requires_belt';
    if (parcel.group === 'fragile') return targetKey === 'rack' ? null : 'fragile_requires_padded_rack';
    return targetKey === 'returns' ? null : 'refused_parcel_requires_return_pallet';
  }

  function targetFor(group) {
    return group === 'normal' ? zones.belt : group === 'fragile' ? zones.rack : zones.returns;
  }

  function slotFor(parcel) {
    const peers = parcels.filter((candidate) => candidate.group === parcel.group);
    const index = peers.findIndex((candidate) => candidate.id === parcel.id);
    const target = targetFor(parcel.group);
    return {
      x: target.x + 12 + (index % 2) * (parcel.w + 8),
      y: target.y + 30 + Math.floor(index / 2) * (parcel.h + 5),
    };
  }

  function activeGroup() {
    const current = phase();
    if (current === 'normal') return 'normal';
    if (current === 'fragile') return 'fragile';
    if (current === 'return') return 'return';
    return null;
  }

  function maybeCompleteSort(group, source) {
    const groupParcels = parcels.filter((parcel) => parcel.group === group);
    if (!groupParcels.every((parcel) => parcel.placed)) return;
    const stepId = group === 'normal' ? 'sort_normal_bulk'
      : group === 'fragile' ? 'sort_fragile_divert'
        : 'sort_return_stack';
    if (completed(stepId)) return;
    const result = actions.attemptStep(stepId, {
      source,
      parcel_ids: groupParcels.map((parcel) => parcel.id),
      handling_mark: groupParcels[0].mark,
    });
    if (!result.ok) showBlocked(result, stepId);
    else {
      lastReason = '';
      audio.tone({ frequency: 610, duration: 0.12, gain: 0.035 });
    }
  }

  function placeParcel(parcel, targetKey, releasePoint, source = 'pointer_drop') {
    const target = zones[targetKey];
    const parcelRect = rectFor(parcel);
    const validGeometry = overlaps(parcelRect, target) && inside(releasePoint, target);
    const reason = validGeometry ? rejectionReason(parcel, targetKey) : 'drop_requires_overlap_and_release_inside_target';
    const groupIsActive = parcel.group === activeGroup();

    if (reason || !groupIsActive) {
      lastReason = reason ?? `step_for_${parcel.group}_not_active`;
      parcel.returning = true;
      parcel.dragging = false;
      parcel.targetX = parcel.homeX;
      parcel.targetY = parcel.homeY;
      audio.tone({ frequency: 155, type: 'square', duration: 0.10, gain: 0.032 });
      debug.stateChanged('return_drop_rejected', { parcel_id: parcel.id, reason: lastReason });
      return { ok: false, reason: lastReason };
    }

    const slot = slotFor(parcel);
    parcel.placed = true;
    parcel.returning = false;
    parcel.dragging = false;
    parcel.targetX = slot.x;
    parcel.targetY = slot.y;
    audio.tone({ frequency: 480, type: 'triangle', duration: 0.075, gain: 0.025 });
    debug.stateChanged('return_parcel_placed', { parcel_id: parcel.id, group: parcel.group });
    maybeCompleteSort(parcel.group, source);
    return { ok: true, reason: 'placed' };
  }

  function deterministicKeyboardDrop() {
    const group = activeGroup();
    if (!group) return { ok: false, reason: 'no_sort_step_active' };
    const parcel = parcels.find((candidate) => candidate.group === group && !candidate.placed);
    if (!parcel) return { ok: true, reason: 'already_sorted' };
    const targetKey = group === 'normal' ? 'belt' : group === 'fragile' ? 'rack' : 'returns';
    const target = zones[targetKey];
    parcel.x = target.x + target.w * 0.36;
    parcel.y = target.y + target.h * 0.35;
    return placeParcel(parcel, targetKey, { x: target.x + target.w / 2, y: target.y + target.h / 2 }, 'keyboard_space');
  }

  function attemptCompactor(source) {
    const result = actions.attemptStep('route_compactor', {
      source,
      material: 'flattened_packaging',
      mechanism: 'hydraulic_lever',
    });
    if (!result.ok) {
      showBlocked(result, 'route_compactor');
      leverPosition = 0;
    } else {
      leverPosition = 1;
      lastReason = '';
      lastMissing = [];
      audio.noise({ duration: 0.18, gain: 0.035, filterFrequency: 620 });
      audio.tone({ frequency: 105, type: 'sawtooth', duration: 0.22, gain: 0.035 });
      debug.stateChanged('return_compactor_complete', {});
    }
    return result;
  }

  function deterministicRollContainer() {
    if (phase() !== 'lane') return { ok: false, reason: 'lane_restore_not_active' };
    containerTargetX = zones.bay.x + zones.bay.w * 0.18;
    containerTargetY = zones.bay.y + zones.bay.h * 0.30;
    const result = actions.attemptStep('restore_lane_access', {
      source: 'keyboard_space',
      container_position: 'equipment_bay',
    });
    if (!result.ok) showBlocked(result, 'restore_lane_access');
    else audio.tone({ frequency: 560, duration: 0.14, gain: 0.035 });
    return result;
  }

  function revealManifest(source) {
    if (phase() !== 'reveal') return { ok: false, reason: 'reveal_not_active' };
    const result = actions.attemptStep('recurring_recipient_reveal', {
      source,
      recipient_code: 'R-4471 / "K. ODELL, UNIT 3B"',
      failed_subscription: true,
    });
    if (!result.ok) showBlocked(result, 'recurring_recipient_reveal');
    else {
      manifestFlashUntil = performance.now() + 4200;
      audio.tone({ frequency: 310, type: 'triangle', duration: 0.12, gain: 0.025 });
      audio.tone({ frequency: 620, type: 'sine', duration: 0.22, gain: 0.028 });
      debug.stateChanged('return_manifest_reveal', { recipient_code: 'R-4471' });
    }
    return result;
  }

  function openDisposition() {
    if (phase() !== 'disposition') return { ok: false, reason: 'disposition_not_active' };
    dispositionOpen = true;
    dispositionPanel.node.hidden = false;
    debug.stateChanged('return_disposition_open', {});
    return { ok: true, reason: 'choice_opened' };
  }

  function acknowledgeBriefing() {
    if (!state().startedAt) actions.startSession();
    if (completed('scan_obstruction')) return { ok: true, reason: 'already_completed' };
    const result = actions.attemptStep('scan_obstruction', {
      source: 'candidate_scanner_briefing',
      scan: 'fixed_manifest_and_lane_obstruction',
    });
    if (result.ok) {
      briefing.node.hidden = true;
      audio.tone({ frequency: 520, type: 'triangle', duration: 0.10, gain: 0.03 });
    } else showBlocked(result, 'scan_obstruction');
    return result;
  }

  briefingButton.addEventListener('click', (event) => {
    event.stopPropagation();
    acknowledgeBriefing();
  });

  function currentTargetAt(point) {
    for (const key of ['belt', 'rack', 'returns']) if (inside(point, zones[key])) return key;
    return null;
  }

  function parcelAt(point) {
    const group = activeGroup();
    return [...parcels].reverse().find((parcel) => !parcel.placed && parcel.group === group && inside(point, rectFor(parcel))) ?? null;
  }

  function leverHandleRect() {
    const track = zones.leverTrack;
    const y = track.y + 10 + leverPosition * (track.h - 34);
    return { x: track.x + 4, y, w: track.w - 8, h: 24 };
  }

  function containerRect() {
    return { x: containerX, y: containerY, w: W * 0.17, h: H * 0.17 };
  }

  function pointerDown(event) {
    const point = toCanvasPoint(event);
    if (!point.inside) return;
    activePointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* host already captures when supported */ }

    const parcel = parcelAt(point);
    if (parcel) {
      draggedParcel = parcel;
      parcel.dragging = true;
      pointerOffset = { x: point.x - parcel.x, y: point.y - parcel.y };
      return;
    }

    if (inside(point, leverHandleRect()) || inside(point, zones.leverTrack)) {
      leverDragging = true;
      leverPosition = clamp((point.y - zones.leverTrack.y) / zones.leverTrack.h, 0, 1);
      return;
    }

    if (phase() === 'lane' && inside(point, containerRect())) {
      containerDragging = true;
      pointerOffset = { x: point.x - containerX, y: point.y - containerY };
    }
  }

  function pointerMove(event) {
    if (activePointerId !== event.pointerId) return;
    const point = toCanvasPoint(event);
    if (draggedParcel) {
      draggedParcel.x = clamp(point.x - pointerOffset.x, 0, W - draggedParcel.w);
      draggedParcel.y = clamp(point.y - pointerOffset.y, 0, H - draggedParcel.h);
      debug.stateChanged('return_parcel_drag', { parcel_id: draggedParcel.id });
    } else if (leverDragging) {
      leverPosition = clamp((point.y - zones.leverTrack.y) / zones.leverTrack.h, 0, 1);
    } else if (containerDragging) {
      containerX = clamp(point.x - pointerOffset.x, 0, W - W * 0.17);
      containerY = clamp(point.y - pointerOffset.y, 0, H - H * 0.17);
    }
  }

  function pointerUp(event) {
    if (activePointerId !== event.pointerId) return;
    const point = toCanvasPoint(event);
    if (draggedParcel) {
      const parcel = draggedParcel;
      draggedParcel = null;
      parcel.dragging = false;
      const targetKey = currentTargetAt(point);
      if (targetKey) placeParcel(parcel, targetKey, point);
      else {
        parcel.returning = true;
        parcel.targetX = parcel.homeX;
        parcel.targetY = parcel.homeY;
        lastReason = 'drop_requires_overlap_and_release_inside_target';
        audio.tone({ frequency: 155, type: 'square', duration: 0.10, gain: 0.032 });
        debug.stateChanged('return_drop_rejected', { parcel_id: parcel.id, reason: lastReason });
      }
    } else if (leverDragging) {
      leverDragging = false;
      if (leverPosition >= 0.72) attemptCompactor('candidate_hydraulic_lever');
      else {
        leverPosition = 0;
        lastReason = 'compactor_lever_not_fully_engaged';
        audio.tone({ frequency: 170, type: 'square', duration: 0.09, gain: 0.025 });
      }
    } else if (containerDragging) {
      containerDragging = false;
      const cRect = containerRect();
      if (overlaps(cRect, zones.bay) && inside(point, zones.bay)) {
        containerTargetX = zones.bay.x + zones.bay.w * 0.18;
        containerTargetY = zones.bay.y + zones.bay.h * 0.30;
        const result = actions.attemptStep('restore_lane_access', {
          source: 'candidate_container_drag',
          container_position: 'equipment_bay',
        });
        if (!result.ok) showBlocked(result, 'restore_lane_access');
        else audio.tone({ frequency: 560, duration: 0.14, gain: 0.035 });
      } else {
        containerTargetX = zones.lane.x + W * 0.015;
        containerTargetY = H * 0.56;
        lastReason = 'container_must_release_inside_equipment_bay';
        audio.tone({ frequency: 170, type: 'square', duration: 0.09, gain: 0.025 });
      }
    }
    activePointerId = null;
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch { /* ignore */ }
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  function easeActors() {
    for (const parcel of parcels) {
      if (parcel.dragging) continue;
      const dx = parcel.targetX - parcel.x;
      const dy = parcel.targetY - parcel.y;
      parcel.vx = parcel.vx * 0.68 + dx * 0.12;
      parcel.vy = parcel.vy * 0.68 + dy * 0.12;
      parcel.x += parcel.vx;
      parcel.y += parcel.vy;
      if (Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35) {
        parcel.x = parcel.targetX;
        parcel.y = parcel.targetY;
        parcel.vx = 0;
        parcel.vy = 0;
        parcel.returning = false;
      }
    }
    if (!containerDragging) {
      containerX += (containerTargetX - containerX) * 0.12;
      containerY += (containerTargetY - containerY) * 0.12;
    }
    if (!leverDragging && !completed('route_compactor')) leverPosition += (0 - leverPosition) * 0.14;
  }

  function drawZone(rect, label, color) {
    ctx.save();
    ctx.fillStyle = `${color}18`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '700 12px ui-monospace,monospace';
    ctx.fillText(label, rect.x + 9, rect.y + 19);
    ctx.restore();
  }

  function drawParcel(parcel) {
    const active = parcel.group === activeGroup() && !parcel.placed;
    ctx.save();
    ctx.fillStyle = parcel.group === 'fragile' ? '#b94750' : parcel.group === 'return' ? '#b86c31' : '#ad7c43';
    ctx.strokeStyle = active ? COLORS.cyan : '#1c2228';
    ctx.lineWidth = active ? 3 : 2;
    ctx.fillRect(parcel.x, parcel.y, parcel.w, parcel.h);
    ctx.strokeRect(parcel.x, parcel.y, parcel.w, parcel.h);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(parcel.x + 7, parcel.y + 7, parcel.w - 14, parcel.h * 0.38);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 10px ui-monospace,monospace';
    ctx.fillText(`${parcel.id}  ${parcel.label}`, parcel.x + 11, parcel.y + 20);
    ctx.fillStyle = '#fff';
    ctx.font = '800 10px ui-monospace,monospace';
    ctx.fillText(parcel.mark, parcel.x + 9, parcel.y + parcel.h - 11);
    if (parcel.group === 'fragile') {
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(parcel.x + parcel.w - 22, parcel.y + 11);
      ctx.lineTo(parcel.x + parcel.w - 13, parcel.y + 28);
      ctx.lineTo(parcel.x + parcel.w - 31, parcel.y + 28);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCompactor() {
    const z = zones.compactor;
    ctx.fillStyle = '#2a3037';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.fillStyle = COLORS.orange;
    ctx.fillRect(z.x + 10, z.y + 12, z.w - 20, z.h * 0.28);
    ctx.fillStyle = '#101317';
    ctx.font = '800 12px ui-monospace,monospace';
    ctx.fillText('PACKAGING COMPACTOR', z.x + 17, z.y + 34);
    ctx.fillStyle = '#7e6a4b';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(z.x + 22 + i * 24, z.y + z.h * 0.54 + i * 3, 68, 7);

    const track = zones.leverTrack;
    ctx.fillStyle = '#20262d';
    ctx.fillRect(track.x, track.y, track.w, track.h);
    const handle = leverHandleRect();
    ctx.fillStyle = completed('route_compactor') ? COLORS.green : COLORS.red;
    ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
    ctx.fillStyle = '#dce8ef';
    ctx.font = '700 9px ui-monospace,monospace';
    ctx.fillText('PULL', track.x + 3, track.y + track.h + 15);
  }

  function drawContainerAndLane() {
    const laneOpen = completed('restore_lane_access');
    ctx.fillStyle = laneOpen ? '#26372c' : '#20252b';
    ctx.fillRect(zones.lane.x, zones.lane.y, zones.lane.w, zones.lane.h);
    ctx.strokeStyle = laneOpen ? COLORS.green : '#59636e';
    ctx.lineWidth = 3;
    ctx.strokeRect(zones.lane.x, zones.lane.y, zones.lane.w, zones.lane.h);
    ctx.fillStyle = laneOpen ? COLORS.green : '#cbd6dd';
    ctx.font = '800 11px ui-monospace,monospace';
    ctx.fillText(laneOpen ? 'LANE 7 OPEN' : 'LANE 7 BLOCKED', zones.lane.x + 10, zones.lane.y + 22);

    drawZone(zones.bay, 'EMPTY CONTAINER BAY', COLORS.green);
    const c = containerRect();
    ctx.fillStyle = '#59616b';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = '#aeb9c4';
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#e7edf2';
    ctx.font = '800 10px ui-monospace,monospace';
    ctx.fillText('EMPTY CONTAINER', c.x + 8, c.y + 18);
  }

  function drawManifest(now) {
    if (phase() !== 'reveal' && phase() !== 'disposition' && now > manifestFlashUntil) return;
    const x = W * 0.35;
    const y = H * 0.12;
    const w = W * 0.42;
    const h = H * 0.29;
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#7d7469';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#20252a';
    ctx.font = '800 12px ui-monospace,monospace';
    ctx.fillText('RETURN MANIFEST // ALLEY 7', x + 16, y + 25);
    ctx.font = '700 11px ui-monospace,monospace';
    ctx.fillText('R-4471 / K. ODELL, UNIT 3B', x + 16, y + 51);
    ctx.fillStyle = COLORS.red;
    ctx.fillText('MONTHLY CRATE × 11 — RENEWAL BOUNCED', x + 16, y + 78);
    ctx.fillText('CANCELLATION NEVER PROPAGATED', x + 16, y + 98);
    ctx.fillStyle = '#20252a';
    ctx.fillText('CAUSE: ONE FAILED SUBSCRIPTION LOOP', x + 16, y + 125);
  }

  function drawFinish() {
    if (phase() !== 'ready_to_finish' && phase() !== 'finished') return;
    ctx.fillStyle = 'rgba(5,10,13,.76)';
    ctx.fillRect(W * 0.12, H * 0.19, W * 0.76, H * 0.29);
    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 2;
    ctx.strokeRect(W * 0.12, H * 0.19, W * 0.76, H * 0.29);
    ctx.fillStyle = COLORS.green;
    ctx.font = '800 23px system-ui,sans-serif';
    ctx.fillText('ALLEY 7 RESTORED', W * 0.18, H * 0.27);
    ctx.fillStyle = '#dbe8ee';
    ctx.font = '600 14px system-ui,sans-serif';
    const hook = scenario.next_hook?.text ?? concept.next_hook;
    ctx.fillText('NEXT BLOCKED-LANE HOOK:', W * 0.18, H * 0.33);
    ctx.font = '600 12px system-ui,sans-serif';
    ctx.fillText(hook.slice(0, 80), W * 0.18, H * 0.38);
    if (hook.length > 80) ctx.fillText(hook.slice(80, 160), W * 0.18, H * 0.42);
  }

  function drawHud() {
    const current = phase();
    ctx.fillStyle = 'rgba(4,9,13,.82)';
    ctx.fillRect(12, 12, W * 0.39, 62);
    ctx.strokeStyle = COLORS.cyan;
    ctx.strokeRect(12, 12, W * 0.39, 62);
    ctx.fillStyle = COLORS.cyan;
    ctx.font = '800 12px ui-monospace,monospace';
    ctx.fillText(`PHASE: ${current.toUpperCase()}`, 24, 34);
    ctx.fillStyle = '#dce8ef';
    ctx.font = '600 10px ui-monospace,monospace';
    if (lastReason) ctx.fillText(`STATUS: ${lastReason}`, 24, 54);
    if (lastMissing.length) ctx.fillText(`MISSING: ${lastMissing.join(', ')}`, 24, 69);
  }

  function syncUi() {
    const p = phase();
    briefing.node.hidden = p !== 'briefing';
    priorityPanel.node.hidden = p !== 'priority';
    if (p === 'priority') renderPriorityStatus();
    if (p !== 'disposition') {
      dispositionOpen = false;
      dispositionPanel.node.hidden = true;
    } else if (dispositionOpen) dispositionPanel.node.hidden = false;

    const prompt = overlay?.querySelector?.('#action-prompt');
    if (prompt) {
      const text = p === 'briefing' ? 'ENTER STARTS // E SCANS THE OBSTRUCTION'
        : p === 'normal' ? 'DRAG NORMAL PARCELS TO BELT // SPACE = NEXT PARCEL'
          : p === 'fragile' ? 'DRAG FRAGILE PARCEL TO PADDED RACK'
            : p === 'return' ? 'DRAG R-4471 CRATES TO RETURN PALLET'
              : p === 'priority' ? 'LOCK RETURNS → NORMAL → FRAGILE'
                : p === 'compactor' ? 'PULL HYDRAULIC LEVER // SPACE FALLBACK'
                  : p === 'lane' ? 'DRAG EMPTY CONTAINER INTO BAY'
                    : p === 'reveal' ? 'PRESS Q TO READ RETURN MANIFEST'
                      : p === 'disposition' ? 'PRESS F TO OPEN DISPOSITION CHOICES'
                        : p === 'ready_to_finish' ? 'PRESS ENTER TO COMPLETE'
                          : p === 'finished' ? 'SESSION COMPLETE'
                            : '';
      prompt.textContent = text;
    }
  }

  function render(now) {
    if (destroyed) return;
    const snapshot = state();
    if (snapshot.sessionId !== currentSession) resetLocalForSession(snapshot.sessionId ?? null);
    easeActors();
    syncUi();

    ctx.clearRect(0, 0, W, H);
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, COLORS.wall);
    gradient.addColorStop(0.42, '#1d2329');
    gradient.addColorStop(1, COLORS.asphalt);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#303841';
    ctx.fillRect(0, H * 0.08, W, H * 0.07);
    ctx.fillStyle = COLORS.amber;
    ctx.font = '800 14px ui-monospace,monospace';
    ctx.fillText('MERIDIAN OVERFLOW DEPOT 7 // SERVICE ALLEY 7', W * 0.04, H * 0.125);

    drawContainerAndLane();
    drawCompactor();
    drawZone(zones.belt, zones.belt.label, COLORS.cyan);
    drawZone(zones.rack, zones.rack.label, COLORS.red);
    drawZone(zones.returns, zones.returns.label, COLORS.orange);

    const beltPhase = (now / 70) % 32;
    ctx.strokeStyle = '#83929e';
    ctx.lineWidth = 2;
    for (let x = zones.belt.x + 12 - beltPhase; x < zones.belt.x + zones.belt.w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, zones.belt.y + zones.belt.h - 15);
      ctx.lineTo(x + 14, zones.belt.y + zones.belt.h - 15);
      ctx.stroke();
    }

    for (const parcel of parcels) drawParcel(parcel);
    drawManifest(now);
    drawFinish();
    drawHud();

    frame = requestAnimationFrame(render);
  }

  function handleVerb(verb, meta = {}) {
    const p = phase();
    if (verb === 'reset_profile') {
      resetLocalForSession(null);
      return false;
    }
    if (verb === 'advance') return false;
    if (verb === 'interact') {
      if (p === 'briefing') return { handled: true, result: acknowledgeBriefing() };
      if (p === 'priority') {
        const next = priorityOrder[prioritySelection.length];
        return { handled: true, result: choosePriority(next, meta.source ?? 'keyboard_interact') };
      }
      return false;
    }
    if (verb === 'core_action') {
      if (p === 'normal' || p === 'fragile' || p === 'return') {
        return { handled: true, result: deterministicKeyboardDrop() };
      }
      if (p === 'priority') {
        const next = priorityOrder[prioritySelection.length];
        return { handled: true, result: choosePriority(next, meta.source ?? 'keyboard_space') };
      }
      if (p === 'compactor') return { handled: true, result: attemptCompactor(meta.source ?? 'keyboard_space') };
      if (p === 'lane') return { handled: true, result: deterministicRollContainer() };
      return false;
    }
    if (verb === 'inspect') {
      if (p === 'reveal') return { handled: true, result: revealManifest(meta.source ?? 'keyboard_q') };
      return false;
    }
    if (verb === 'commit_choice') {
      if (p === 'disposition') return { handled: true, result: openDisposition() };
      return false;
    }
    return false;
  }

  function handlePlayerAction(action, meta = {}) {
    if (action?.step_id !== 'route_compactor') return false;
    return {
      handled: true,
      result: attemptCompactor(meta.source ?? 'descriptor_player_action'),
    };
  }

  frame = requestAnimationFrame(render);

  return {
    handleVerb,
    handlePlayerAction,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      briefing.node.remove();
      priorityPanel.node.remove();
      dispositionPanel.node.remove();
      if (overlay && originalOverlay) {
        overlay.style.inset = originalOverlay.inset;
        overlay.style.bottom = originalOverlay.bottom;
        overlay.style.display = originalOverlay.display;
        overlay.style.pointerEvents = originalOverlay.pointerEvents;
      }
    },
    getDebugState() {
      return {
        phase: phase(),
        parcels: parcels.map((parcel) => ({
          id: parcel.id,
          group: parcel.group,
          handling_mark: parcel.mark,
          placed: parcel.placed,
          x: Number(parcel.x.toFixed(1)),
          y: Number(parcel.y.toFixed(1)),
        })),
        priority_selection: [...prioritySelection],
        lever_position: Number(leverPosition.toFixed(3)),
        container: { x: Number(containerX.toFixed(1)), y: Number(containerY.toFixed(1)) },
        disposition_open: dispositionOpen,
        last_reason: lastReason,
        missing: [...lastMissing],
      };
    },
  };
}
