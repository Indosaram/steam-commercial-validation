/**
 * FAKE IT TILL YOU CLEAN IT - candidate scenario descriptor (Task 2).
 *
 * One set: the gold-coated pool and courtyard of an abandoned influencer
 * estate. The player is a cleanup contractor. The gold is a sprayed staging
 * coat applied for the camera; underneath it the pool shell is cracked and
 * rotten. Stripping the coat IS the core action, and the reveal is what the
 * coat was hiding.
 *
 * Contract notes (core/scenario-contract.js + shell/shell.js):
 *  - Step kinds map to the shared required events:
 *      inspect -> inspect_performed      (E / interact)
 *      core_action -> core_action_completed (Space)
 *      reveal -> signature_reveal_seen   (Q / inspect verb)
 *      choice -> choice_committed        (F)
 *  - The shell fires the FIRST pending step of a requested kind, so declaration
 *    order is the play order within a kind. Prerequisites make that ordering
 *    enforced rather than merely conventional.
 *  - `requires` may only name EARLIER steps; a forward reference is rejected by
 *    validateDescriptor() as a soft-lock.
 *
 * Invalid-path design (the deliberate blocked requirement):
 *  - `disposition` (the evidence choice) requires `reveal`. Committing the
 *    evidence choice before the decayed surface is exposed is blocked by name:
 *    blockedSteps() reports missing ['reveal'].
 *  - `reveal` requires `strip_deck`, the last debris/cleaning step. Attempting
 *    to finish or reveal with debris remaining is blocked by name and the
 *    scenario cannot be completed: shell/shell.js `advance()` refuses to emit
 *    `scenario_completed` while any descriptor step is still incomplete.
 *
 * No real influencers, platforms, celebrities, brands, or trademark designs are
 * referenced. The estate, its owner, and every prop are fictional.
 */

/** Visible set states, in the order the player drives them. */
const SET = Object.freeze({
  staged: 'courtyard_gold_staged_pristine_for_camera',
  debris_cleared: 'courtyard_gold_intact_deck_and_water_clear_of_debris',
  water_drained: 'pool_drained_gold_coat_fully_exposed_dry',
  coat_stripped: 'pool_basin_gold_coat_stripped_to_bare_shell',
  deck_stripped: 'courtyard_deck_gold_coat_stripped_substrate_visible',
  decay_exposed: 'pool_shell_cracked_water_stained_decayed_under_gold',
  archived: 'evidence_object_dispositioned_set_documented',
});

export default {
  concept_id: 'fake_it_till_you_clean_it',

  set: {
    id: 'gold_pool_courtyard',
    label: 'Gold-coated pool and courtyard, abandoned estate',
    description:
      'A single enclosed courtyard: one kidney-shaped pool sprayed gold to the '
      + 'waterline, a gold-dusted deck, four toppled ring lights, and a stack of '
      + 'unopened shipping crates used as set dressing. Nothing beyond this set '
      + 'is reachable in this scenario.',
    initial_state: SET.staged,
    final_state: SET.archived,
  },

  steps: [
    // --- objective -------------------------------------------------------
    {
      id: 'inspect_objective',
      kind: 'inspect',
      label: 'Inspect the cleanup objective board',
      description:
        'Read the work order pinned at the courtyard gate: strip the staging '
        + 'coat from the pool and deck, and log anything the coat was covering.',
      prompt: 'Press E to read the work order.',
      transformation: {
        before: 'objective_unknown_contractor_just_arrived',
        after: 'objective_known_strip_staging_coat_and_log_findings',
      },
      duration_ms: 80_000,
    },

    // --- debris ----------------------------------------------------------
    {
      id: 'collect_debris',
      kind: 'core_action',
      label: 'Collect debris from the deck and pool water',
      description:
        'Bag the toppled ring lights, drink cups, and gold-flecked leaf litter '
        + 'floating in the pool. The set reads as "styled" until the loose '
        + 'debris is gone; only then is the coated surface actually visible.',
      prompt: 'Press Space to collect debris.',
      requires: ['inspect_objective'],
      transformation: {
        before: SET.staged,
        after: SET.debris_cleared,
      },
      debris_cleared: true,
      duration_ms: 110_000,
    },

    // --- three ordered cleaning / restoration core actions ---------------
    {
      id: 'drain_pool',
      kind: 'core_action',
      label: 'Drain the pool to expose the coated basin',
      description:
        'Pump out the standing water. The gold stops exactly at the old '
        + 'waterline - the coat was only ever applied to what the camera saw.',
      prompt: 'Press Space to drain the pool.',
      requires: ['collect_debris'],
      transformation: {
        before: SET.debris_cleared,
        after: SET.water_drained,
      },
      cleaning_pass: 1,
      duration_ms: 110_000,
    },
    {
      id: 'strip_basin',
      kind: 'core_action',
      label: 'Strip the gold coat from the pool basin',
      description:
        'Work the solvent wand across the basin. The gold lifts in sheets, '
        + 'because it was sprayed straight onto unprepared concrete.',
      prompt: 'Press Space to strip the basin coat.',
      requires: ['drain_pool'],
      transformation: {
        before: SET.water_drained,
        after: SET.coat_stripped,
      },
      cleaning_pass: 2,
      duration_ms: 110_000,
    },
    {
      id: 'strip_deck',
      kind: 'core_action',
      label: 'Strip and wash the courtyard deck',
      description:
        'Take the same pass across the deck and rinse the residue to the drain. '
        + 'With the last coated surface cleared, the set is fully readable.',
      prompt: 'Press Space to strip the deck.',
      requires: ['strip_basin'],
      transformation: {
        before: SET.coat_stripped,
        after: SET.deck_stripped,
      },
      cleaning_pass: 3,
      final_debris_step: true,
      duration_ms: 110_000,
    },

    // --- signature reveal ------------------------------------------------
    {
      id: 'reveal_decayed_surface',
      kind: 'reveal',
      label: 'Signature reveal: the decayed surface under the gold',
      description:
        'Stripped bare, the shell shows what the coat was for: a split running '
        + 'the length of the basin, black water staining, and rebar showing '
        + 'through. Taped inside the skimmer housing is a shot list - camera '
        + 'marks, sun times, and the note "gold only where frame reaches". The '
        + 'estate was never restored. It was dressed for one set of photos.',
      prompt: 'Press Q to inspect the bare shell.',
      requires: ['strip_deck'],
      transformation: {
        before: SET.deck_stripped,
        after: SET.decay_exposed,
      },
      staged_success_clue: {
        id: 'skimmer_shot_list',
        label: 'Laminated shot list taped inside the skimmer housing',
        proves:
          'the gold coat was applied only inside camera framing, so the '
          + 'restoration was staged for images rather than performed',
      },
      duration_ms: 80_000,
    },

    // --- evidence disposition (gated on the reveal) ----------------------
    {
      id: 'disposition',
      kind: 'choice',
      label: 'Decide the fate of the shot list: preserve, discard, or archive',
      description:
        'The shot list is the only physical proof the restoration was staged. '
        + 'Preserve it in place for the property record, discard it with the '
        + 'stripping waste, or archive it into the contractor evidence log.',
      prompt: 'Press F to commit the disposition.',
      // The named gate: no disposition before the reveal exposes the clue.
      requires: ['reveal_decayed_surface'],
      evidence_object: 'skimmer_shot_list',
      options: [
        {
          id: 'preserve',
          label: 'Preserve in place',
          consequence: 'The clue stays with the property and transfers to the next owner.',
        },
        {
          id: 'discard',
          label: 'Discard with the stripping waste',
          consequence: 'The staging is erased along with the coat; only your word remains.',
        },
        {
          id: 'archive',
          label: 'Archive to the contractor evidence log',
          consequence: 'The clue leaves the estate and enters the record you control.',
        },
      ],
      default_option: 'archive',
      transformation: {
        before: SET.decay_exposed,
        after: SET.archived,
      },
      duration_ms: 90_000,
    },
  ],

  /** Deterministic replay ordering used by the replay/smoke driver. */
  replay: [
    'inspect_objective',
    'collect_debris',
    'drain_pool',
    'strip_basin',
    'strip_deck',
    'reveal_decayed_surface',
    'disposition',
  ],

  /**
   * The named blocked requirements this candidate must demonstrate. Each entry
   * is an intentionally invalid path; `missing` is what blockedSteps() reports.
   */
  invalid_paths: [
    {
      id: 'disposition_before_reveal',
      attempt: 'disposition',
      completed: ['inspect_objective', 'collect_debris', 'drain_pool', 'strip_basin', 'strip_deck'],
      expect_missing: ['reveal_decayed_surface'],
      requirement: 'expose_decayed_surface_before_dispositioning_evidence',
      message:
        'Blocked: the shot list cannot be preserved, discarded, or archived '
        + 'before the bare shell is inspected and the staging is exposed.',
    },
    {
      id: 'exit_with_debris_remaining',
      attempt: 'reveal_decayed_surface',
      completed: ['inspect_objective'],
      expect_missing: ['strip_deck'],
      requirement: 'clear_debris_and_complete_all_cleaning_passes_before_exit',
      message:
        'Blocked: debris and coated surfaces remain. The scenario cannot be '
        + 'completed while any cleaning pass is outstanding.',
    },
  ],

  /** Before/after proof the capture evidence must show. */
  visible_proof: {
    before: SET.staged,
    after: SET.decay_exposed,
    assertion:
      'the gold-coated surface and the stripped, decayed surface are visibly '
      + 'different states of the same pool',
  },

  /** Shown after completion; no second room is built in this scenario. */
  next_hook: {
    id: 'second_room_flagged',
    label: 'A second estate room is flagged with the same staging pattern',
    detail:
      'The work order updates: the guest wing shows the same gold spray inside '
      + 'one camera arc. Not reachable in this scenario.',
  },
};
