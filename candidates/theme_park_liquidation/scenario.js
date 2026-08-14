/**
 * THEME PARK LIQUIDATION - direct-play scenario descriptor (Task 4).
 *
 * Scope cap (plan, Task 4): ONE sealed souvenir shop plus ONE parade-float /
 * show-control space. No open-world park, no autonomous mascot AI, no
 * stealth/horror chase, no second attraction. The second attraction exists only
 * as the closing hook line, never as playable space.
 *
 * The player is the liquidation crew. The scenario is a single unbroken chain:
 *
 *   1  open the sealed shop and read the room            (inspect)
 *   2  triage merchandise batch A                        (core_action)
 *   3  triage merchandise batch B                        (core_action)
 *   4  drag the collapsed display rack off the guest path (core_action)
 *   5  sweep the shattered float debris from the path    (core_action)
 *   6  pull the drive belt + fuse from a triaged batch   (core_action)
 *   7  refit the float turntable drive                   (core_action)
 *   8  reseat the show-control lighting fuse             (core_action)
 *   9  read the packing manifest under the merch pile    (reveal)
 *  10  decide restore / display / dispose                (choice)
 *  11  run the recovered mascot show                     (core_action)
 *  12  log the next sealed attraction                    (inspect)
 *
 * The Task 4 gate is structural, not cosmetic: step 11 transitively requires
 * both path-clearing steps (4, 5) AND both repair steps (7, 8). Because
 * core/scenario-contract.js `blockedSteps()` refuses any step with an unmet
 * prerequisite, "start the show while the path is blocked" and "start the show
 * without the repair parts" are unreachable states rather than discouraged
 * ones - and both surface a NAMED blocked reason in the shell, with no
 * scenario_completed event.
 *
 * Every step declares:
 *   requires        ordered prerequisites (the invalid-path gate)
 *   transformation  a visible before -> after world state change
 *   space           which of the two authored spaces it happens in
 *   beat            which Task 4 requirement it discharges
 *   duration_ms     authored pacing, summing inside the 10-15 minute window
 *
 * Same-kind steps are declared in dependency order on purpose: the browser
 * shell resolves a keypress to the FIRST pending step of that kind, so the
 * declared order IS the played order.
 */

/** Authored pacing: 60s intro + 690s of steps + 60s wrap = 13.5 min. */
const INTRO_MS = 60_000;
const WRAP_MS = 60_000;

export default {
  concept_id: 'theme_park_liquidation',

  title: 'THEME PARK LIQUIDATION - Souvenir Shop 4 & Float Bay',
  premise:
    'Pinewick Gardens closed mid-season with its stock still on the shelves. '
    + 'You have one shift to strip Souvenir Shop 4, clear the guest path through '
    + 'to the float bay, and get the mascot show running one last time for the '
    + 'liquidation record.',

  spaces: {
    souvenir_shop: {
      id: 'souvenir_shop',
      label: 'Souvenir Shop 4 (sealed)',
      opening_state: 'Sealed since closing day. Shelves loaded, floor blocked by a collapsed rack.',
    },
    show_control: {
      id: 'show_control',
      label: 'Float bay & show control booth',
      opening_state: 'Parade float mid-rotation on a dead turntable. Control booth dark.',
    },
  },

  intro_ms: INTRO_MS,
  wrap_ms: WRAP_MS,

  steps: [
    {
      id: 'open_shop',
      kind: 'inspect',
      beat: 'survey',
      space: 'souvenir_shop',
      label: 'Cut the seal and survey Souvenir Shop 4',
      detail:
        'Two years of stock, one collapsed display rack across the guest path, '
        + 'and a float bay you cannot reach yet.',
      requires: [],
      transformation: {
        before: 'shop_sealed_dark',
        after: 'shop_open_lit_inventory_visible',
      },
      duration_ms: 55_000,
    },

    // ---- merchandise triage: the failed stock ------------------------------
    {
      id: 'triage_plush',
      kind: 'core_action',
      beat: 'merch_triage',
      space: 'souvenir_shop',
      label: 'Triage the mascot plush batch',
      detail:
        'Four hundred plush in sealed poly bags. Sun-bleached on the window side, '
        + 'clean in the back stock. Sorted into resale, salvage, and write-off.',
      requires: ['open_shop'],
      transformation: {
        before: 'plush_wall_unsorted',
        after: 'plush_split_resale_salvage_writeoff',
      },
      duration_ms: 70_000,
    },
    {
      id: 'triage_collectibles',
      kind: 'core_action',
      beat: 'merch_triage',
      space: 'souvenir_shop',
      label: 'Triage the collectible figure crates',
      detail:
        'Crates of numbered figures, still shrink-wrapped, most of them the same '
        + 'four numbers. Something about the run counts does not add up.',
      requires: ['triage_plush'],
      transformation: {
        before: 'collectible_crates_stacked_unopened',
        after: 'collectible_crates_opened_counted',
      },
      duration_ms: 70_000,
    },

    // ---- guest path: what blocks the way to the float bay -------------------
    {
      id: 'clear_rack',
      kind: 'core_action',
      beat: 'path_clear',
      space: 'souvenir_shop',
      label: 'Drag the collapsed display rack off the guest path',
      detail:
        'The rack fell across the shop-to-bay doorway. It only moves once the '
        + 'stock on top of it has been triaged off.',
      requires: ['triage_collectibles'],
      transformation: {
        before: 'guest_path_blocked_by_rack',
        after: 'guest_path_half_clear_doorway_open',
      },
      duration_ms: 65_000,
    },
    {
      id: 'clear_debris',
      kind: 'core_action',
      beat: 'path_clear',
      space: 'show_control',
      label: 'Sweep the shattered float trim off the bay walkway',
      detail:
        'Fibreglass trim sheared off the float when the turntable jammed. '
        + 'The walkway is a hazard until it is swept and binned.',
      requires: ['clear_rack'],
      transformation: {
        before: 'bay_walkway_strewn_with_trim',
        after: 'bay_walkway_clear_guest_path_open',
      },
      duration_ms: 65_000,
    },

    // ---- show control repair: parts come from the triaged stock -------------
    {
      id: 'recover_parts',
      kind: 'core_action',
      beat: 'control_repair',
      space: 'souvenir_shop',
      label: 'Pull the drive belt and lighting fuse from the salvage pile',
      detail:
        'Maintenance was cannibalising the shop stockroom before closing. The '
        + 'belt and the 15A fuse are in the salvage pile you just sorted.',
      requires: ['triage_plush', 'clear_rack'],
      transformation: {
        before: 'repair_parts_unlocated',
        after: 'drive_belt_and_fuse_in_hand',
      },
      duration_ms: 60_000,
    },
    {
      id: 'refit_drive',
      kind: 'core_action',
      beat: 'control_repair',
      space: 'show_control',
      label: 'Refit the float turntable drive belt',
      detail:
        'The mechanical half of the show component: belt onto the pulley, '
        + 'tension set, turntable freed by hand.',
      requires: ['recover_parts'],
      transformation: {
        before: 'turntable_seized_belt_snapped',
        after: 'turntable_turning_freely',
      },
      duration_ms: 70_000,
    },
    {
      id: 'reseat_fuse',
      kind: 'core_action',
      beat: 'control_repair',
      space: 'show_control',
      label: 'Reseat the show-control lighting fuse',
      detail:
        'The electrical half: blown 15A fuse replaced, booth board wakes up, '
        + 'cue lamps green.',
      requires: ['refit_drive'],
      transformation: {
        before: 'control_booth_dark_board_dead',
        after: 'control_booth_lit_cues_armed',
      },
      duration_ms: 60_000,
    },

    // ---- signature reveal: the collectible boom failed mid-production -------
    {
      id: 'manifest_clue',
      kind: 'reveal',
      beat: 'clue',
      space: 'souvenir_shop',
      label: 'Read the packing manifest buried under the collectible crates',
      detail:
        'The collectible boom that funded this park failed mid-production: the '
        + 'manifest shows the numbered run was reprinted with the same four '
        + 'serials over and over, then the final wave was cancelled by the '
        + 'factory. The park kept selling the crates anyway.',
      requires: ['triage_collectibles', 'reseat_fuse'],
      transformation: {
        before: 'manifest_buried_unread',
        after: 'manifest_read_boom_failure_documented',
      },
      duration_ms: 60_000,
    },

    // ---- meaningful decision -----------------------------------------------
    {
      id: 'batch_disposition',
      kind: 'choice',
      beat: 'disposition',
      space: 'souvenir_shop',
      label: 'Commit a disposition for the recovered collectible batch',
      prompt:
        'The collectible batch is documented as a failed run. What goes on the '
        + 'liquidation record?',
      options: [
        {
          id: 'restore',
          label: 'Restore - clean and re-box the batch for resale',
          outcome:
            'The batch re-enters inventory at resale grade. The manifest stays '
            + 'in the file, and the failed run is sold as genuine stock.',
        },
        {
          id: 'display',
          label: 'Display - stage the batch and the manifest together in the show',
          outcome:
            'The failed run becomes the show exhibit. Lower recovered value, '
            + 'but the manifest goes on the record next to it.',
        },
        {
          id: 'dispose',
          label: 'Dispose - crush the batch and log it as a write-off',
          outcome:
            'The batch is destroyed. The write-off is clean and the evidence of '
            + 'the failed run goes with it.',
        },
      ],
      requires: ['manifest_clue'],
      transformation: {
        before: 'collectible_batch_undecided',
        after: 'collectible_batch_disposition_logged',
      },
      duration_ms: 60_000,
    },

    // ---- the payoff: the show can only start now ---------------------------
    {
      id: 'run_show',
      kind: 'core_action',
      beat: 'show_start',
      space: 'show_control',
      label: 'Start the recovered mascot show',
      detail:
        'Ninety seconds of the original parade cue: turntable rotates, the '
        + 'mascot float lights come up, the show runs once for the liquidation '
        + 'record. It is a scripted playback cue, not an autonomous character.',
      gate:
        'Requires the guest path clear (rack dragged off, bay walkway swept) AND '
        + 'the show control repaired (drive belt refitted, lighting fuse reseated).',
      blocked_message:
        'Show start refused: the guest path is not clear and/or the show control '
        + 'is not repaired.',
      requires: ['clear_debris', 'reseat_fuse', 'batch_disposition'],
      transformation: {
        before: 'float_bay_dead_show_never_run',
        after: 'mascot_show_running_cue_complete',
      },
      duration_ms: 55_000,
    },

    // ---- next-attraction hook ----------------------------------------------
    {
      id: 'next_attraction_hook',
      kind: 'inspect',
      beat: 'next_hook',
      space: 'show_control',
      label: 'Log the show cue sheet and the next sealed attraction',
      detail:
        'The recovered cue sheet routes the float onward to a second sealed '
        + 'attraction still on the liquidation list.',
      requires: ['run_show'],
      transformation: {
        before: 'liquidation_record_open',
        after: 'record_closed_next_attraction_flagged',
      },
      duration_ms: 50_000,
    },
  ],

  /** Deterministic replay ordering for the replay driver and smoke evidence. */
  replay: [
    'open_shop',
    'triage_plush',
    'triage_collectibles',
    'clear_rack',
    'clear_debris',
    'recover_parts',
    'refit_drive',
    'reseat_fuse',
    'manifest_clue',
    'batch_disposition',
    'run_show',
    'next_attraction_hook',
  ],

  /**
   * The two authored invalid paths Task 4 requires. Both are structurally
   * unreachable via `requires`; these entries document what the blocked state
   * must say when a player attempts them.
   */
  invalid_paths: [
    {
      id: 'show_with_blocked_path',
      attempt: 'run_show',
      withhold: ['clear_rack', 'clear_debris'],
      expect_blocked_on: ['clear_debris'],
      message: 'Show start refused: the guest path is still blocked.',
    },
    {
      id: 'show_without_repair_parts',
      attempt: 'run_show',
      withhold: ['recover_parts', 'refit_drive', 'reseat_fuse'],
      expect_blocked_on: ['reseat_fuse'],
      message: 'Show start refused: the show control is not repaired.',
    },
  ],
};
