/**
 * RETURN TO SENDER - candidate scenario descriptor (Task 3, Wave 2).
 *
 * One blocked delivery container/alley. The player is the logistics clearer who
 * scans the obstruction, resolves parcels into the normal / fragile / return
 * handling lanes, commits ONE priority order before touching the compactor,
 * routes the pile, restores lane access, sees why the alley kept filling up,
 * and disposes of the recurring recipient's parcel.
 *
 * This descriptor is DATA ONLY. It edits nothing in core/, shell/ or tools/:
 * the shared loader (core/candidate.js) reads it, the shared contract
 * (core/scenario-contract.js) validates it, and the shared browser shell
 * (shell/shell.js) renders its ordered steps, prerequisite blocks and
 * before/after transformations. That is the Wave 2 isolation contract.
 *
 * ---------------------------------------------------------------- ordering
 *
 * Step order is chosen so the shared telemetry causal order holds:
 *
 *   session_started -> core_action_completed(x4) -> signature_reveal_seen
 *   -> choice_committed -> scenario_completed -> session_ended
 *
 * The priority decision is therefore NOT the schema `choice` step. It is a
 * recorded, gating commitment (`priority_order_committed`, kind `inspect` ->
 * `inspect_performed`) that must precede any compaction or exit. The schema
 * `choice` step is the disposition of the recurring recipient's parcel, which
 * can only be understood after the reveal. Both are real decisions; only one
 * of them is allowed by the shared schema to be `choice_committed`.
 *
 * ------------------------------------------------------------ invalid paths
 *
 * Two invalid paths are authored as hard prerequisite gates rather than as
 * damage, so every failure is recoverable and legible:
 *
 *   1. Compact the fragile parcel early. `route_compactor` requires the fragile
 *      parcel to already be diverted (`sort_fragile_divert`) AND the priority
 *      order to be committed. Attempting it first yields the named block
 *      `invalid_action_blocked { attempted: 'route_compactor',
 *      missing: [...] }` and the shell's status line names the penalty.
 *   2. Exit before the priority queue is resolved. The shared shell refuses
 *      `scenario_completed` while any step is incomplete, so pressing Enter
 *      early emits `invalid_action_blocked { reason: 'beats_incomplete' }`
 *      and no `scenario_completed` is written.
 *
 * Neither path destroys progress: the blocked step stays available and the
 * player continues from the same state.
 *
 * ------------------------------------------------------------- guardrails
 *
 * No Steam APIs. No real delivery company: the carrier is the fictional
 * in-world depot "MERIDIAN OVERFLOW DEPOT 7". Parcel contents are authored and
 * fixed - opening a parcel never rolls a random value, has no resale price, no
 * market, no wager and no reward currency. The recurring recipient clue is a
 * failed subscription with a bounced renewal, not a gambling loop.
 */

/** In-world labels kept in one place so the fiction stays consistent. */
const DEPOT = 'MERIDIAN OVERFLOW DEPOT 7';
const RECIPIENT_CODE = 'R-4471 / "K. ODELL, UNIT 3B"';

export default {
  concept_id: 'return_to_sender',

  title: 'RETURN TO SENDER - Alley 7 overflow',
  setting: `${DEPOT}, service alley 7: a container tipped its overflow across the only lane to the loading door.`,
  role: 'Logistics clearer unblocking an overflowing delivery alley',

  /**
   * The lane state machine the steps drive. Each value is a visible state the
   * shell reports as a before/after transformation, so "did anything actually
   * change?" is answerable from the event stream alone.
   */
  lane_states: [
    'lane_blocked_full',
    'lane_scanned',
    'lane_normal_cleared',
    'lane_fragile_secured',
    'lane_returns_staged',
    'lane_priority_locked',
    'lane_compacted',
    'lane_access_restored',
  ],

  steps: [
    {
      id: 'scan_obstruction',
      kind: 'inspect',
      label: 'Scan the blocked container and alley 7',
      detail:
        `Handheld scanner sweep of the tipped container. 3 handling classes detected: ` +
        `normal, fragile, return. Lane to the loading door is impassable.`,
      transformation: { before: 'lane_blocked_full', after: 'lane_scanned' },
      duration_ms: 80_000,
    },

    // ---------------------------------------------------------- core loop
    // The repeated core action: resolve one parcel into its handling lane.
    // Three distinct categories are resolved (normal / fragile / return), plus
    // a fourth normal pass, so the shared "at least 3 core actions" holds with
    // margin and every category is provably touched.
    {
      id: 'sort_normal_bulk',
      kind: 'core_action',
      label: 'Sort the normal parcels onto the belt',
      parcel_category: 'normal',
      detail:
        'Undamaged standard parcels are scanned and belted to the loading door side. The lane mouth opens.',
      requires: ['scan_obstruction'],
      transformation: { before: 'lane_scanned', after: 'lane_normal_cleared' },
      duration_ms: 110_000,
    },
    {
      id: 'sort_fragile_divert',
      kind: 'core_action',
      label: 'Divert the fragile parcel to the padded rack',
      parcel_category: 'fragile',
      detail:
        'FRAGILE tape, glass-marked. It is carried, not belted, and racked away from the compactor path.',
      requires: ['scan_obstruction', 'sort_normal_bulk'],
      transformation: { before: 'lane_normal_cleared', after: 'lane_fragile_secured' },
      // Authored safety rule the invalid path violates.
      compactor_safe: false,
      duration_ms: 110_000,
    },
    {
      id: 'sort_return_stack',
      kind: 'core_action',
      label: 'Stack the refused/return parcels for pickup',
      parcel_category: 'return',
      detail:
        `Refused and undeliverable parcels are stacked on the return pallet. Most of them carry ` +
        `the same recipient code: ${RECIPIENT_CODE}.`,
      requires: ['sort_fragile_divert'],
      transformation: { before: 'lane_fragile_secured', after: 'lane_returns_staged' },
      duration_ms: 110_000,
    },

    // ------------------------------------------------- the priority decision
    // Recorded and gating: nothing may be compacted or exited before this.
    {
      id: 'priority_order_committed',
      kind: 'inspect',
      label: 'Commit the parcel priority order (returns -> normal -> fragile)',
      detail:
        'Priority queue locked on the depot terminal: return pallet ships first, normal backlog second, ' +
        'fragile hand-carried last. The compactor stays interlocked until this order exists.',
      decision: {
        prompt: 'Which order clears alley 7 without crushing anything that must survive?',
        options: [
          'returns_first (chosen): the return pallet leaves the lane before anything is compacted',
          'normal_first: faster belt throughput, but the return pallet stays in the lane',
          'fragile_first: fastest to look clear, highest breakage risk at the compactor',
        ],
        committed: 'returns_first',
        gates: ['route_compactor', 'restore_lane_access'],
      },
      requires: ['sort_return_stack'],
      transformation: { before: 'lane_returns_staged', after: 'lane_priority_locked' },
      duration_ms: 60_000,
    },

    // ------------------------------------------------ compaction / routing
    {
      id: 'route_compactor',
      kind: 'core_action',
      label: 'Route the emptied packaging through the compactor',
      parcel_category: 'packaging_waste',
      detail:
        'Only flattened outer packaging goes in. The fragile rack and the return pallet are outside the ' +
        'compactor path by construction, because they were resolved first.',
      // The two invalid-path gates, stated as data.
      requires: ['sort_fragile_divert', 'priority_order_committed'],
      invalid_if_missing: {
        sort_fragile_divert:
          'PENALTY compactor_interlock_fragile: the fragile parcel is still in the compactor path. ' +
          'Divert it to the padded rack first.',
        priority_order_committed:
          'PENALTY compactor_interlock_no_priority: the compactor is interlocked until a priority order is committed.',
      },
      transformation: { before: 'lane_priority_locked', after: 'lane_compacted' },
      duration_ms: 110_000,
    },
    {
      id: 'restore_lane_access',
      kind: 'core_action',
      label: 'Roll the emptied container back and reopen the lane',
      detail:
        'The container is walked back into its bay and the loading door line is walked end to end. ' +
        'Alley 7 is passable again.',
      requires: ['route_compactor'],
      transformation: { before: 'lane_compacted', after: 'lane_access_restored' },
      duration_ms: 90_000,
    },

    // ------------------------------------------------------------- reveal
    {
      id: 'recurring_recipient_reveal',
      kind: 'reveal',
      label: 'Read the return pallet manifest',
      detail:
        `Every refused parcel on the pallet is one monthly crate for ${RECIPIENT_CODE}. The subscription ` +
        'renewal bounced eleven months ago, the cancellation never propagated, and the depot has been ' +
        'shipping and refusing the same crate ever since. The alley was not overloaded - it was one ' +
        'failed subscription looping.',
      clue: {
        recipient_code: RECIPIENT_CODE,
        failed_subscription: 'MONTHLY CRATE, renewal bounced, cancellation never propagated',
        refused_crates: 11,
      },
      requires: ['restore_lane_access'],
      transformation: { before: 'lane_access_restored', after: 'lane_access_restored_cause_known' },
      duration_ms: 80_000,
    },

    // ------------------------------------------------------------- choice
    {
      id: 'commit_return_disposition',
      kind: 'choice',
      label: 'Commit the disposition for the recurring recipient stack',
      detail:
        'Return to sender with the loop flagged, hold the pallet at the depot, or push it back down the ' +
        'line unflagged. Only the flagged return stops alley 7 from refilling next month.',
      decision: {
        prompt: `What happens to the ${RECIPIENT_CODE} stack?`,
        options: [
          'return_to_sender_flagged (chosen): ship back and flag the dead subscription',
          'hold_at_depot: the pallet stays and the lane narrows again',
          'reship_unflagged: the loop continues untouched',
        ],
        committed: 'return_to_sender_flagged',
      },
      requires: ['recurring_recipient_reveal'],
      transformation: { before: 'lane_access_restored_cause_known', after: 'lane_clear_loop_flagged' },
      duration_ms: 90_000,
    },
  ],

  player_actions: [
    {
      id: 'attempt_route_compactor',
      step_id: 'route_compactor',
      keyboard: ['Digit1'],
      label: 'Attempt the packaging compactor route',
    },
  ],

  /** Deterministic replay ordering for the scripted driver and manual QA. */
  replay: [
    'scan_obstruction',
    'sort_normal_bulk',
    'sort_fragile_divert',
    'sort_return_stack',
    'priority_order_committed',
    'route_compactor',
    'restore_lane_access',
    'recurring_recipient_reveal',
    'commit_return_disposition',
  ],

  /**
   * The two authored invalid paths, declared so QA drivers and reviewers test
   * the same things the fiction promises. Each is a recoverable, named block:
   * progress is never lost and no scenario_completed is emitted.
   */
  invalid_paths: [
    {
      id: 'compact_fragile_early',
      description: 'Attempt the compactor before the fragile parcel is diverted and before the priority order exists.',
      attempt_step: 'route_compactor',
      completed_before_attempt: ['scan_obstruction'],
      expect_blocked: true,
      expect_missing: ['sort_fragile_divert', 'priority_order_committed'],
      penalty: 'compactor_interlock_fragile',
      recoverable: true,
      expect_no_completion: true,
    },
    {
      id: 'exit_before_priority_queue',
      description: 'Attempt to finish the scenario before the priority order is committed.',
      attempt_step: 'scenario_completed',
      completed_before_attempt: ['scan_obstruction', 'sort_normal_bulk', 'sort_fragile_divert', 'sort_return_stack'],
      expect_blocked: true,
      expect_missing: ['priority_order_committed'],
      penalty: 'exit_blocked_priority_unresolved',
      recoverable: true,
      expect_no_completion: true,
    },
  ],

  /** Next-scenario hook shown after completion (shared shell emits next_hook_shown). */
  next_hook: {
    id: 'alley_9_second_blocked_lane',
    text: `Alley 9 at ${DEPOT} is reported blocked tonight, and its manifest carries the same recipient code ${RECIPIENT_CODE}.`,
  },

  /** Explicit guardrail record for the scope audit (F4). */
  guardrails: {
    no_random_loot: 'Parcel contents are authored and fixed; opening one never rolls a value.',
    no_gambling: 'No betting, odds, currency, resale or market of any kind.',
    no_real_company_parody: `Fictional depot "${DEPOT}"; no real carrier name, livery or trade dress.`,
    no_steam_api: 'No Steam integration, store page, or festival-registration surface.',
    scope: 'One container and one alley. No city-scale map.',
  },
};
