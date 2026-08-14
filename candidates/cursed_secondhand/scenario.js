/**
 * CURSED SECONDHAND - single-item workshop scenario descriptor.
 *
 * Candidate build for Task 5. Owned entirely by this directory: it adds no
 * code to core/, shell/, or tools/, and imports nothing from another
 * candidate. The shared foundation loads this file through
 * core/candidate.js -> /bootstrap.json -> shell/shell.js.
 *
 * The item
 * --------
 * INTAKE 0417: a wall-mounted brass pendulum clock that arrived stopped at
 * 4:17 with its pendulum still swinging. One item, one back-room workshop.
 * There is no shop economy, no procedural generator, no crafting loop, and no
 * second item to restore - the second crate only ever appears as a hook.
 *
 * Ordered proof chain (each step's `requires` is the invalid-path gate)
 * --------------------------------------------------------------------
 *   diagnose        inspect      read dust / damage / curse traces
 *   dust_pass       core_action  restoration pass 1  (tool: soft brush)
 *   solder_pass     core_action  restoration pass 2  (tool: solder iron)
 *   trace_pass      core_action  restoration pass 3  (tool: trace salt)
 *   memory_clue     inspect      the previous owner's personal memory
 *   interior_reveal reveal       brief reversible interior-space opening
 *   disposition     choice       return / archive / seal
 *
 * Three DISTINCT restoration actions, not one action repeated: each uses a
 * different tool, changes a different property of the item (surface, movement,
 * curse trace), and produces its own visible before/after pair. Each one also
 * re-diagnoses what changed, which is this concept's declared core action.
 *
 * Why the reveal cannot be reached early
 * --------------------------------------
 * `interior_reveal` requires `memory_clue`, which requires all three
 * restoration passes, each of which chains back to `diagnose`. Skipping the
 * diagnostic or any tool pass therefore leaves the reveal blocked by the
 * shared blockedSteps() gate, and the shell names the exact missing step
 * instead of soft-locking: every blocked step remains performable as soon as
 * its prerequisite is done, and no step consumes or destroys another.
 *
 * The reveal is REVERSIBLE by construction: `interior_reveal.transformation`
 * returns the workshop to `workshop_restored`, the same state the interior
 * opened from, so the scenario can be completed, reset, and replayed without
 * an irreversible world change. The disposition choice is the only committed
 * decision, and it is taken after the reveal has already closed.
 */

/** Timing budget, tuned to the shared 10-15 minute target window.
 *
 * intro (session start) is owned by the shell; these are the step durations:
 *   80 + 3*110 + 95 + 85 + 90 = 680s = 11.3 min of scripted active play,
 * which lands inside the 10-15 minute window with headroom at both ends for
 * a human owner reading the workshop text rather than replaying a script.
 */
const D = Object.freeze({
  diagnose_ms: 80_000,
  restoration_pass_ms: 110_000,
  memory_clue_ms: 95_000,
  reveal_ms: 85_000,
  disposition_ms: 90_000,
});

export default {
  concept_id: 'cursed_secondhand',

  item: {
    intake_id: 'INTAKE-0417',
    name: 'Brass pendulum wall clock, stopped at 4:17',
    unusual_because: 'the movement is seized but the pendulum has never stopped swinging',
    provenance: 'left in a house-clearance lot with no claimant and no paperwork',
  },

  /** The three trace categories the diagnostic must separate before any tool is used. */
  traces: [
    { kind: 'dust', reading: 'settled house dust over the dial, thickest along the 4-5 arc' },
    { kind: 'damage', reading: 'a cracked solder joint on the strike lever, movement seized' },
    { kind: 'curse', reading: 'a cold residue that re-forms on the glass minutes after wiping' },
  ],

  steps: [
    {
      id: 'diagnose',
      kind: 'inspect',
      label: 'Diagnose the intake: dust, damage, and curse traces',
      duration_ms: D.diagnose_ms,
      detail:
        'Three separable readings on one item: settled dust, a cracked strike-lever solder joint, '
        + 'and a cold residue that re-forms after wiping. Naming all three unlocks the tools.',
      unlocks_tools: ['soft_brush', 'solder_iron', 'trace_salt'],
      transformation: {
        before: 'item_unread_no_tools_available',
        after: 'three_traces_named_tools_unlocked',
      },
    },

    {
      id: 'dust_pass',
      kind: 'core_action',
      label: 'Restoration pass 1/3 - brush the dust layer and re-diagnose',
      requires: ['diagnose'],
      duration_ms: D.restoration_pass_ms,
      tool: 'soft_brush',
      restores: 'surface',
      detail:
        'The soft brush lifts the dust arc off the dial. Re-diagnosing shows the engraved '
        + 'owner initials that the dust was covering.',
      transformation: {
        before: 'dial_dust_caked_numerals_unreadable',
        after: 'dial_clear_owner_initials_visible',
      },
    },
    {
      id: 'solder_pass',
      kind: 'core_action',
      label: 'Restoration pass 2/3 - resolder the strike lever and re-diagnose',
      requires: ['dust_pass'],
      duration_ms: D.restoration_pass_ms,
      tool: 'solder_iron',
      restores: 'movement',
      detail:
        'Rejoining the cracked lever frees the seized movement. Re-diagnosing shows the hands '
        + 'move again but still return to 4:17.',
      transformation: {
        before: 'movement_seized_strike_lever_cracked',
        after: 'movement_running_hands_return_to_4_17',
      },
    },
    {
      id: 'trace_pass',
      kind: 'core_action',
      label: 'Restoration pass 3/3 - draw off the curse trace and re-diagnose',
      requires: ['solder_pass'],
      duration_ms: D.restoration_pass_ms,
      tool: 'trace_salt',
      restores: 'curse_trace',
      detail:
        'Trace salt pulls the cold residue off the glass into the tray, where it settles into a '
        + 'readable shape instead of re-forming.',
      transformation: {
        before: 'glass_cold_residue_reforming',
        after: 'residue_drawn_into_tray_holding_a_shape',
      },
    },

    {
      id: 'memory_clue',
      kind: 'inspect',
      label: 'Read the personal-memory clue held in the drawn-off trace',
      requires: ['trace_pass'],
      duration_ms: D.memory_clue_ms,
      detail:
        'The settled residue holds one domestic memory: the previous owner stopped this clock by '
        + 'hand at 4:17 and wound it every day afterwards without ever letting it run. The initials '
        + 'brushed clear in pass 1 are hers. The item is not malicious - it is held.',
      clue: 'owner_stopped_the_clock_by_hand_at_4_17_and_kept_winding_it',
      transformation: {
        before: 'trace_shape_unread',
        after: 'previous_owner_memory_named',
      },
    },

    {
      id: 'interior_reveal',
      kind: 'reveal',
      label: 'The clock face opens onto the room it was stopped in',
      requires: ['memory_clue'],
      duration_ms: D.reveal_ms,
      detail:
        'The dial swings inward and the workshop wall becomes the far side of a small domestic room '
        + 'held at 4:17 - one window, one chair, the clock on the wall. It stays open for the length '
        + 'of one pendulum sweep, then closes and the workshop returns exactly as it was.',
      reversible: true,
      reverts_to: 'workshop_restored',
      transformation: {
        before: 'workshop_restored',
        after: 'workshop_restored_after_interior_glimpse',
      },
    },

    {
      id: 'disposition',
      kind: 'choice',
      label: 'Decide the item: return, archive, or seal',
      requires: ['interior_reveal'],
      duration_ms: D.disposition_ms,
      detail:
        'The interior has already closed. The decision is made on the restored item in the workshop, '
        + 'with the memory known.',
      default_option: 'archive',
      options: [
        {
          id: 'return',
          label: 'Return it to the claimant address on the intake docket',
          consequence: 'the room it holds goes back to a house that may still want it running',
        },
        {
          id: 'archive',
          label: 'Archive it intact in the back-room shelf',
          consequence: 'the memory stays readable, and the clock stays stopped on purpose',
        },
        {
          id: 'seal',
          label: 'Seal the trace and sell it as an ordinary clock',
          consequence: 'it runs clean for the next owner, and the room inside is closed for good',
        },
      ],
      transformation: {
        before: 'restored_item_undecided_on_bench',
        after: 'disposition_committed_bench_cleared',
      },
    },
  ],

  /** Deterministic replay ordering for the smoke/replay drivers. */
  replay: [
    'diagnose',
    'dust_pass',
    'solder_pass',
    'trace_pass',
    'memory_clue',
    'interior_reveal',
    'disposition',
  ],

  /**
   * Invalid paths the shared gate must deny with a named, actionable missing
   * step rather than a soft-lock. Consumed by this candidate's own tests.
   */
  invalid_paths: [
    {
      id: 'reveal_without_diagnosis',
      description: 'attempt the interior reveal from a clean intake, skipping the diagnostic',
      completed: [],
      attempt: 'interior_reveal',
      expect_missing: ['memory_clue'],
    },
    {
      id: 'reveal_with_diagnosis_but_no_tools',
      description: 'diagnose, then attempt the reveal without performing any restoration pass',
      completed: ['diagnose'],
      attempt: 'interior_reveal',
      expect_missing: ['memory_clue'],
    },
    {
      id: 'final_restoration_with_a_skipped_tool',
      description: 'skip the solder pass and attempt the third restoration pass',
      completed: ['diagnose', 'dust_pass'],
      attempt: 'trace_pass',
      expect_missing: ['solder_pass'],
    },
    {
      id: 'clue_before_the_trace_is_drawn_off',
      description: 'attempt to read the memory clue before the curse trace is drawn off',
      completed: ['diagnose', 'dust_pass', 'solder_pass'],
      attempt: 'memory_clue',
      expect_missing: ['trace_pass'],
    },
    {
      id: 'disposition_before_the_reveal',
      description: 'attempt to commit the disposition before the interior has opened',
      completed: ['diagnose', 'dust_pass', 'solder_pass', 'trace_pass', 'memory_clue'],
      attempt: 'disposition',
      expect_missing: ['interior_reveal'],
    },
  ],

  /** Next-scenario hook. A hook only: no second item is restorable in this build. */
  next_hook: {
    id: 'intake_0418',
    text: 'INTAKE-0418 is logged in the receiving book with the same cold-residue trace signature.',
    promises: 'another single item, not an endless queue',
  },
};
