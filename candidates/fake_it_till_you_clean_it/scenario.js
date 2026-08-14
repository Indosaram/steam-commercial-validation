/**
 * FAKE IT TILL YOU CLEAN IT - expanded candidate scenario descriptor.
 *
 * The player starts at the gold-coated pool courtyard, exposes the decay hidden
 * under its camera-only finish, then follows the same staging pattern into a
 * second room: the glamour vanity. Cleaning the vanity exposes a concealed safe
 * seam; inspecting the safe reveals receipts that prove the luxury props were
 * repeatedly rented for shoots rather than owned as part of a real renovation.
 *
 * Contract notes (core/scenario-contract.js + shell/shell.js):
 *  - Step kinds map to the shared required events.
 *  - The shell fires the FIRST pending step of a requested kind.
 *  - `requires` only names EARLIER steps so ordered prerequisites cannot soft-lock.
 *  - Every authored state-changing beat includes explicit before/after proof.
 */

/** Visible set states, in the order the player drives them. */
const SET = Object.freeze({
  staged: 'courtyard_gold_staged_pristine_for_camera',
  debris_cleared: 'courtyard_gold_intact_deck_and_water_clear_of_debris',
  water_drained: 'pool_drained_gold_coat_fully_exposed_dry',
  coat_stripped: 'pool_basin_gold_coat_stripped_to_bare_shell',
  deck_stripped: 'courtyard_deck_gold_coat_stripped_substrate_visible',
  decay_exposed: 'pool_decay_exposed_glamour_vanity_still_staged',
  vanity_cleaned: 'pool_decay_exposed_glamour_vanity_cleaned_safe_seam_visible',
  receipt_found: 'hidden_vanity_safe_open_recurring_prop_rental_receipts_exposed',
  archived: 'staging_evidence_bundle_dispositioned_set_documented',
});

export default {
  concept_id: 'fake_it_till_you_clean_it',

  set: {
    id: 'gold_pool_courtyard',
    label: 'Gold-coated pool courtyard and connected glamour vanity',
    description:
      'A compact two-area cleanup route: the gold-coated pool courtyard opens '
      + 'into a sealed glamour vanity room used for camera-ready beauty shoots. '
      + 'No other estate rooms are reachable in this scenario.',
    areas: [
      {
        id: 'gold_pool_courtyard',
        label: 'Gold-coated pool courtyard',
        role: 'opening_cleanup_area',
      },
      {
        id: 'glamour_vanity',
        label: 'Glamour vanity room',
        role: 'second_room_escalation',
      },
    ],
    initial_state: SET.staged,
    final_state: SET.archived,
  },

  steps: [
    {
      id: 'inspect_objective',
      kind: 'inspect',
      label: 'Inspect the cleanup objective board',
      description:
        'Read the work order pinned at the courtyard gate: strip the staging '
        + 'coat, log what it concealed, then clear any connected room showing '
        + 'the same camera-only treatment.',
      prompt: 'Press E to read the work order.',
      transformation: {
        before: 'objective_unknown_contractor_just_arrived',
        after: 'objective_known_strip_staging_coat_and_log_findings',
      },
      duration_ms: 80_000,
    },
    {
      id: 'collect_debris',
      kind: 'core_action',
      label: 'Collect debris from the deck and pool water',
      description:
        'Bag the toppled ring lights, drink cups, and gold-flecked leaf litter '
        + 'floating in the pool so the coated surface can be read clearly.',
      prompt: 'Press Space to collect debris.',
      requires: ['inspect_objective'],
      transformation: {
        before: SET.staged,
        after: SET.debris_cleared,
      },
      debris_cleared: true,
      duration_ms: 110_000,
    },
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
        'Work the solvent wand across the basin. The gold lifts in sheets '
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
        + 'With the last courtyard surface cleared, the set is fully readable.',
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
    {
      id: 'reveal_decayed_surface',
      kind: 'reveal',
      label: 'Signature reveal: the decayed surface under the gold',
      description:
        'Stripped bare, the shell shows a split running the length of the basin, '
        + 'black water staining, and exposed rebar. Taped inside the skimmer is '
        + 'a shot list marked "gold only where frame reaches". A notation on the '
        + 'same sheet flags the glamour vanity as the next staged camera zone.',
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
          'the gold coat was applied only inside camera framing and the same '
          + 'staging plan continued into the glamour vanity',
      },
      duration_ms: 80_000,
    },
    {
      id: 'restore_glamour_vanity',
      kind: 'core_action',
      area_id: 'glamour_vanity',
      label: 'Clean the glamour vanity and expose the concealed safe seam',
      description:
        'Clear adhesive gems, powder residue, and metallic spray from the mirror '
        + 'surround and vanity top. As the staged finish comes away, a rectangular '
        + 'seam and recessed latch appear behind the mirror backing.',
      prompt: 'Press Space to restore the glamour vanity.',
      requires: ['reveal_decayed_surface'],
      transformation: {
        before: SET.decay_exposed,
        after: SET.vanity_cleaned,
      },
      cleaning_pass: 4,
      duration_ms: 55_000,
    },
    {
      id: 'safe_receipt_clue',
      kind: 'inspect',
      area_id: 'glamour_vanity',
      label: 'Discover the hidden safe receipts',
      description:
        'Open the newly exposed latch and inspect a bundle of recurring prop-rental '
        + 'receipts. Luxury jewelry, designer-style display pieces, and gold staging '
        + 'materials were rented for 48-hour shoots, returned, then rented again for '
        + 'later posts. The apparent permanent luxury inventory never existed.',
      prompt: 'Press E to inspect the hidden safe.',
      requires: ['restore_glamour_vanity'],
      transformation: {
        before: SET.vanity_cleaned,
        after: SET.receipt_found,
      },
      evidence_clue: {
        id: 'safe_receipt_clue',
        label: 'Recurring prop-rental receipts from the concealed vanity safe',
        proves:
          'the estate repeatedly rented camera-facing luxury props instead of '
          + 'owning the inventory presented as permanent wealth',
      },
      duration_ms: 50_000,
    },
    {
      id: 'disposition',
      kind: 'choice',
      label: 'Decide the fate of the staging evidence: preserve, discard, or archive',
      description:
        'The skimmer shot list and safe receipts now form one evidence bundle. '
        + 'Preserve it with the property, discard it with the stripping waste, '
        + 'or archive it into the contractor evidence log.',
      prompt: 'Press F to commit the disposition.',
      requires: ['safe_receipt_clue'],
      evidence_object: 'staging_evidence_bundle',
      options: [
        {
          id: 'preserve',
          label: 'Preserve in place',
          consequence: 'The evidence stays with the property and transfers to the next owner.',
        },
        {
          id: 'discard',
          label: 'Discard with the stripping waste',
          consequence: 'The staging record is erased; only your account remains.',
        },
        {
          id: 'archive',
          label: 'Archive to the contractor evidence log',
          consequence: 'The evidence leaves the estate and enters the record you control.',
        },
      ],
      default_option: 'archive',
      transformation: {
        before: SET.receipt_found,
        after: SET.archived,
      },
      duration_ms: 90_000,
    },
  ],

  replay: [
    'inspect_objective',
    'collect_debris',
    'drain_pool',
    'strip_basin',
    'strip_deck',
    'reveal_decayed_surface',
    'restore_glamour_vanity',
    'safe_receipt_clue',
    'disposition',
  ],

  invalid_paths: [
    {
      id: 'disposition_before_safe_receipt',
      attempt: 'disposition',
      completed: [
        'inspect_objective',
        'collect_debris',
        'drain_pool',
        'strip_basin',
        'strip_deck',
        'reveal_decayed_surface',
        'restore_glamour_vanity',
      ],
      expect_missing: ['safe_receipt_clue'],
      requirement: 'discover_safe_receipt_before_dispositioning_evidence',
      message:
        'Blocked: the evidence bundle cannot be dispositioned before the concealed '
        + 'safe is inspected and its rental receipts are logged.',
    },
    {
      id: 'safe_receipt_before_vanity_cleanup',
      attempt: 'safe_receipt_clue',
      completed: [
        'inspect_objective',
        'collect_debris',
        'drain_pool',
        'strip_basin',
        'strip_deck',
        'reveal_decayed_surface',
      ],
      expect_missing: ['restore_glamour_vanity'],
      requirement: 'clean_glamour_vanity_before_opening_hidden_safe',
      message:
        'Blocked: the safe seam and latch are still concealed beneath the staged '
        + 'vanity finish, so the receipt clue cannot be inspected yet.',
    },
    {
      id: 'exit_with_debris_remaining',
      attempt: 'reveal_decayed_surface',
      completed: ['inspect_objective'],
      expect_missing: ['strip_deck'],
      requirement: 'clear_debris_and_complete_all_courtyard_cleaning_before_reveal',
      message:
        'Blocked: debris and coated courtyard surfaces remain. The reveal cannot '
        + 'occur while the cleaning chain is outstanding.',
    },
  ],

  visible_proof: {
    before: SET.staged,
    after: SET.receipt_found,
    assertion:
      'the camera-ready gold courtyard and vanity become visibly stripped, '
      + 'damaged spaces with a concealed evidence cache exposed',
  },

  next_hook: {
    id: 'third_zone_flagged',
    label: 'A third estate camera zone is flagged for the next contract',
    detail:
      'One receipt references a sealed wardrobe studio booked under the same '
      + '48-hour staging account. It is not reachable in this scenario.',
  },
};
