/**
 * PANIC! AT THE PAWNSHOP - one-shift appraisal scenario (Task 6, Wave 2).
 *
 * Role:      appraiser working one closing shift in a post-bubble pawnshop
 * Loop:      inspect an item with an evidence tool -> record what it proves ->
 *            commit an appraisal + disposition backed by that evidence
 * Reveal:    the scarcity that set the prices was manufactured, not real
 * Hook:      the next shift queue is seeded with items from the same scheme
 *
 * Design rules this descriptor obeys (Task 6 acceptance criteria):
 *
 *  1. Exactly three items cross the counter.
 *  2. Each item is inspected with at least TWO distinct evidence tools, one of
 *     which is always the UV lamp.
 *  3. Every evidence step records a legible, human-readable finding. The player
 *     reads reasons, never a hidden answer key.
 *  4. An appraisal (`core_action`) declares BOTH of its item's evidence steps as
 *     prerequisites. The shared `blockedSteps()` gate therefore refuses an
 *     appraisal that has no evidence behind it, and names exactly which
 *     evidence is missing. That is the whole anti-guessing mechanism: ordered
 *     prerequisites, never a dice roll.
 *  5. One item is an authored FAKE, one is legitimate and personally meaningful,
 *     and one is genuine but priced by manufactured scarcity - which is what
 *     turns the third appraisal into the reveal.
 *  6. Contradicting the recorded evidence is allowed but carries a NAMED,
 *     EXPLAINED, RECOVERABLE consequence (see `items[].contradiction`), never an
 *     opaque random result and never a soft-lock.
 *
 * This descriptor is pure data. It is consumed by the shared loader
 * (core/candidate.js) and the shared browser shell; the candidate edits no
 * shared code. Item metadata beyond the shared contract fields is additive and
 * ignored by the foundation validator, while this candidate's own replay driver
 * and tests read it.
 *
 * Contains no external economy or speculative-price mechanics: every number
 * below is fixed authored content inside one closed shift.
 */

/** The three items on the counter, in shift order. */
export const ITEMS = [
  {
    item_id: 'chrono_sig_watch',
    display_name: 'CHRONO-SIG "Founders Run" wristwatch',
    ticket_claim: 'Seller claims 1 of 300, boom-era collectible, asks 4,200.',
    truth: 'forged',
    meaning:
      'A convincing counterfeit riding the collapsed watch boom; the seller was cheated upstream, not lying.',
    correct_appraisal: 'counterfeit_reproduction',
    correct_disposition: 'decline_and_document',
    offer: 0,
    consequence:
      'The seller is refused a loan but leaves with a written finding they can take to the dealer who sold it to them.',
    contradiction: {
      appraisal: 'authentic_limited_run',
      name: 'BAD PAPER',
      explanation:
        'Booking a counterfeit as authentic puts a forged serial on the shop ledger; the shift log flags BAD PAPER against your name and the loan is written against an item worth nothing.',
      recoverable: true,
      recovery:
        'Reopen the ticket, cite the UV and serial findings, and rebook the item as a counterfeit before the shift closes.',
      contradicts: ['watch_uv', 'watch_serial'],
    },
  },
  {
    item_id: 'bakery_ledger',
    display_name: 'Handwritten bakery ledger, 1994-2001',
    ticket_claim: 'Seller asks 60 and apologises for wasting your time.',
    truth: 'authentic',
    meaning:
      'A real, unremarkable working ledger: seven years of a family bakery, with the last page recording the day it closed and a photograph of the staff tucked into the spine.',
    correct_appraisal: 'authentic_low_market_value',
    correct_disposition: 'offer_fair_and_advise_keep',
    offer: 40,
    consequence:
      'You pay a fair 40 and tell the seller plainly it is worth more to her than to the shop; she keeps the photograph.',
    contradiction: {
      appraisal: 'worthless_reject',
      name: 'COLD COUNTER',
      explanation:
        'Dismissing a genuine item as worthless to close the ticket faster costs the shop its walk-in trust; the shift log records a COLD COUNTER complaint and the seller leaves without the appraisal she came for.',
      recoverable: true,
      recovery:
        'Call her back before the shift ends, cite the ink-aging and provenance findings, and rebook a fair offer.',
      contradicts: ['ledger_uv', 'ledger_provenance'],
    },
  },
  {
    item_id: 'panic_edition_card',
    display_name: 'PANIC EDITION sealed collectible, "1 of 500"',
    ticket_claim: 'Seller has eleven identical sealed copies and wants a price on all of them.',
    truth: 'authentic_but_manufactured_scarcity',
    meaning:
      'Genuinely factory-sealed and genuinely printed by the issuer - and the issuer printed the same "1 of 500" plate at least four times.',
    correct_appraisal: 'authentic_but_scarcity_manufactured',
    correct_disposition: 'offer_melt_value_and_disclose',
    offer: 25,
    consequence:
      'You price it as a printed card rather than a rarity, and tell the seller why the eleven copies are the evidence.',
    contradiction: {
      appraisal: 'authentic_rare_collectible',
      name: 'BUBBLE BOOK',
      explanation:
        'Booking a mass-printed card at boom prices puts the shop back into the bubble it just survived; the shift log flags BUBBLE BOOK and the shop takes eleven copies of a worthless rarity onto its own shelves.',
      recoverable: true,
      recovery:
        'Reopen the ticket, cite the duplicate plate codes under UV and the registry batch record, and rebook at printed value.',
      contradicts: ['card_uv', 'card_registry'],
    },
  },
];

/**
 * Ordered shift beats.
 *
 * Prerequisite chain per item:  UV evidence -> tool-2 evidence -> appraisal.
 * The appraisal therefore cannot be reached from a cold start, and cannot be
 * reached with only one tool used. The reveal requires all three appraisals,
 * and the disposition choice requires the reveal.
 */
const steps = [
  {
    id: 'open_shift',
    kind: 'inspect',
    label: 'Open the shift and read the three intake tickets',
    finding:
      'Three tickets on the counter: a boom-era wristwatch, a handwritten bakery ledger, and a sealed "1 of 500" collectible.',
    evidence_kind: 'provenance',
  },

  // --------------------------------------------------------- item 1: fake
  {
    id: 'watch_uv',
    kind: 'inspect',
    item: 'chrono_sig_watch',
    tool: 'uv_lamp',
    label: 'UV lamp: sweep the watch dial and caseback',
    finding:
      'Under UV the dial lume glows evenly bright across all markers - a factory 1990s dial ages unevenly and reads dull amber. The caseback engraving fluoresces at its edges, meaning it was cut after plating.',
    evidence_kind: 'forged',
    supports: 'forged',
    transformation: { before: 'watch_under_daylight', after: 'watch_under_uv_even_glow' },
  },
  {
    id: 'watch_serial',
    kind: 'inspect',
    item: 'chrono_sig_watch',
    tool: 'serial_registry',
    label: 'Serial registry: look up the caseback number',
    finding:
      'Serial CS-0177-300 resolves to a run that ended at 0150. The registry has no 0177, and the font kerning on the caseback does not match any registered plate.',
    evidence_kind: 'authentic',
    supports: 'forged',
    requires: ['watch_uv'],
  },
  {
    id: 'appraise_watch',
    kind: 'core_action',
    item: 'chrono_sig_watch',
    label: 'Appraise the watch and commit a disposition',
    requires: ['watch_uv', 'watch_serial'],
    transformation: { before: 'ticket_open_claim_4200', after: 'ticket_booked_counterfeit_declined' },
  },

  // -------------------------------------------------- item 2: legitimate
  {
    id: 'ledger_uv',
    kind: 'inspect',
    item: 'bakery_ledger',
    tool: 'uv_lamp',
    label: 'UV lamp: check the ledger ink and paper',
    finding:
      'The paper fluoresces dull and unevenly, consistent with uncoated 1990s stock, and the ink fades progressively page to page - written over years, not in one sitting. No optical brighteners, so nothing here was reprinted recently.',
    evidence_kind: 'authentic',
    supports: 'authentic',
    transformation: { before: 'ledger_closed', after: 'ledger_open_under_uv' },
  },
  {
    id: 'ledger_provenance',
    kind: 'inspect',
    item: 'bakery_ledger',
    tool: 'loupe',
    label: 'Loupe: read the final page and the spine',
    finding:
      'Last entry, 2001: "closed today, sold the mixer". A staff photograph is tucked into the spine with six names on the back. No collector market exists for this - it is worth about 40 as paper and everything else to the person holding it.',
    evidence_kind: 'value',
    supports: 'authentic',
    requires: ['ledger_uv'],
  },
  {
    id: 'appraise_ledger',
    kind: 'core_action',
    item: 'bakery_ledger',
    label: 'Appraise the ledger and commit a disposition',
    requires: ['ledger_uv', 'ledger_provenance'],
    transformation: { before: 'ticket_open_claim_60', after: 'ticket_booked_fair_offer_40' },
  },

  // ------------------------------- item 3: genuine, manufactured scarcity
  {
    id: 'card_uv',
    kind: 'inspect',
    item: 'panic_edition_card',
    tool: 'uv_lamp',
    label: 'UV lamp: read the plate code through the sealed sleeve',
    finding:
      'The issuer plate code is UV-only ink under the seal. This copy reads PLATE-D. Two other copies from the same seller read PLATE-A and PLATE-C - three different plates all numbered "1 of 500".',
    evidence_kind: 'authentic',
    supports: 'authentic_but_manufactured_scarcity',
    transformation: { before: 'sealed_card_ordinary', after: 'sealed_card_plate_code_visible' },
  },
  {
    id: 'card_registry',
    kind: 'inspect',
    item: 'panic_edition_card',
    tool: 'serial_registry',
    label: 'Serial registry: pull the issuer batch record',
    finding:
      'The registry lists four separate print batches for PANIC EDITION, each stamped "1 of 500", totalling at least 2,000 sealed copies. The seal, the print and the issuer are all genuine. The scarcity is not.',
    evidence_kind: 'value',
    supports: 'authentic_but_manufactured_scarcity',
    requires: ['card_uv'],
  },
  {
    id: 'appraise_card',
    kind: 'core_action',
    item: 'panic_edition_card',
    label: 'Appraise the sealed collectible and commit a disposition',
    requires: ['card_uv', 'card_registry'],
    transformation: { before: 'ticket_open_rarity_claim', after: 'ticket_booked_printed_value_disclosed' },
  },

  // ------------------------------------------------------------- payoff
  {
    id: 'scarcity_reveal',
    kind: 'reveal',
    label: 'The board goes up: the scarcity was manufactured',
    finding:
      'Pinning the three tickets to the shift board lines the evidence up: four plates of a "1 of 500" card, a counterfeit built to ride the same boom, and one honest ledger nobody was ever asked to fake. The scarcity that set every price on this counter was manufactured, and the shop paid boom prices for two years on the strength of it.',
    requires: ['appraise_watch', 'appraise_ledger', 'appraise_card'],
    transformation: { before: 'shift_board_three_open_tickets', after: 'shift_board_scheme_mapped' },
  },
  {
    id: 'commit_shift_disposition',
    kind: 'choice',
    label: 'Commit the shift: file the scheme, hold the tickets, or book them quietly',
    requires: ['scarcity_reveal'],
    transformation: { before: 'tickets_pending_review', after: 'shift_ledger_closed_and_filed' },
  },
];

export default {
  concept_id: 'panic_at_the_pawnshop',
  title: 'PANIC! AT THE PAWNSHOP',
  shift: 'closing shift, three tickets',
  items: ITEMS,
  evidence_tools: ['uv_lamp', 'serial_registry', 'loupe'],
  steps,
  replay: steps.map((s) => s.id),
  next_shift_hook:
    'The overnight intake queue is already seeded with nine more sealed PANIC EDITION copies from three different sellers - the same plate codes, the same scheme, next shift.',
};
