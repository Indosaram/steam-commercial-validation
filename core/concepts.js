/**
 * Canonical concept registry for the five validation candidates.
 *
 * These IDs are the shared vocabulary for telemetry, profiles, scorecards and
 * decision records. They are frozen: candidate builds (Tasks 2-6) must adopt
 * these exact strings so cross-candidate comparison stays possible.
 *
 * Nothing here describes store pages, pricing, or marketplace mechanics.
 */

/** @typedef {'fake_it_till_you_clean_it'|'return_to_sender'|'theme_park_liquidation'|'cursed_secondhand'|'panic_at_the_pawnshop'} ConceptId */

const TARGET_MINUTES = Object.freeze({ min: 10, max: 15 });

/**
 * The shared proof contract every candidate must satisfy, restated per concept
 * so a build author cannot silently drop one of the six required beats.
 */
const CONCEPT_LIST = [
  {
    concept_id: 'fake_it_till_you_clean_it',
    title: 'FAKE IT TILL YOU CLEAN IT',
    role: 'Cleanup contractor restoring an abandoned influencer estate',
    core_action: 'Strip staged-luxury coating from a surface and restore what is underneath',
    signature_reveal: 'The gold coating hides a decayed surface staged purely for the camera',
    choice: 'Preserve, discard, or archive one staged-success evidence object',
    next_hook: 'A second estate room is flagged with the same staging pattern',
  },
  {
    concept_id: 'return_to_sender',
    title: 'RETURN TO SENDER',
    role: 'Logistics clearer unblocking an overflowing delivery alley',
    core_action: 'Sort a parcel into its correct normal/fragile/return handling lane',
    signature_reveal: 'One recipient drives the whole overflow through a failed subscription',
    choice: 'Commit a parcel priority order before clearing the obstruction',
    next_hook: 'A second blocked lane shows the same recurring recipient code',
  },
  {
    concept_id: 'theme_park_liquidation',
    title: 'THEME PARK LIQUIDATION',
    role: 'Liquidation crew triaging a sealed souvenir shop and its show space',
    core_action: 'Triage a failed merchandise batch and clear the guest path it blocks',
    signature_reveal: 'The collectible boom that funded the park visibly failed mid-production',
    choice: 'Restore, display, or dispose of one recovered merchandise batch',
    next_hook: 'The recovered mascot show points at a second sealed attraction',
  },
  {
    concept_id: 'cursed_secondhand',
    title: 'CURSED SECONDHAND',
    role: 'Restorer working a single unusual secondhand item in a back-room workshop',
    core_action: 'Apply one distinct restoration pass and re-diagnose what changed',
    signature_reveal: 'The item opens a brief interior space carrying its previous owner memory',
    choice: 'Return, archive, or seal the restored item',
    next_hook: 'A second intake crate is logged with the same trace signature',
  },
  {
    concept_id: 'panic_at_the_pawnshop',
    title: 'PANIC! AT THE PAWNSHOP',
    role: 'Appraiser working one shift in a post-bubble pawnshop',
    core_action: 'Inspect an item with an evidence tool and record what it proves',
    signature_reveal: 'The scarcity that set the prices was manufactured, not real',
    choice: 'Commit an appraisal and disposition for an item using recorded evidence',
    next_hook: 'The next shift queue is seeded with items from the same scheme',
  },
];

/** @type {Readonly<Record<string, Readonly<object>>>} */
export const CONCEPTS = Object.freeze(
  Object.fromEntries(
    CONCEPT_LIST.map((c) => [
      c.concept_id,
      Object.freeze({ ...c, target_minutes: TARGET_MINUTES }),
    ]),
  ),
);

/** Frozen, ordered list of the five valid concept IDs. */
export const CONCEPT_IDS = Object.freeze(CONCEPT_LIST.map((c) => c.concept_id));

/**
 * @param {string} conceptId
 * @returns {Readonly<object>} the frozen concept definition
 * @throws {Error} when the ID is missing or not one of the five
 */
export function getConcept(conceptId) {
  if (!conceptId) {
    throw new Error('missing concept_id: a launch must name one of the five concept IDs');
  }
  const concept = CONCEPTS[conceptId];
  if (!concept) {
    throw new Error(
      `unknown concept_id "${conceptId}"; expected one of: ${CONCEPT_IDS.join(', ')}`,
    );
  }
  return concept;
}

/** @param {string} conceptId */
export function isConceptId(conceptId) {
  return Object.prototype.hasOwnProperty.call(CONCEPTS, conceptId);
}
