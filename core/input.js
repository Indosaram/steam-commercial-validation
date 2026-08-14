/**
 * Shared input mapping for all five candidate builds.
 *
 * Every candidate binds its scenario verbs to these six shared verbs so the
 * owner does not have to relearn controls between builds. Candidate builds may
 * label a verb differently in their own UI ("scrub", "sort", "appraise") but
 * must not rebind the physical inputs.
 */

/** @typedef {'interact'|'core_action'|'inspect'|'commit_choice'|'advance'|'reset_profile'} SharedVerb */

export const INPUT_MAP = Object.freeze({
  interact: Object.freeze({
    keyboard: Object.freeze(['KeyE']),
    gamepad: Object.freeze(['BUTTON_A']),
    label: 'Interact / pick up',
  }),
  core_action: Object.freeze({
    keyboard: Object.freeze(['Space']),
    gamepad: Object.freeze(['BUTTON_X']),
    label: 'Perform the repeated core action',
  }),
  inspect: Object.freeze({
    keyboard: Object.freeze(['KeyQ']),
    gamepad: Object.freeze(['BUTTON_Y']),
    label: 'Inspect / diagnose',
  }),
  commit_choice: Object.freeze({
    keyboard: Object.freeze(['KeyF']),
    gamepad: Object.freeze(['BUTTON_B']),
    label: 'Commit the meaningful choice',
  }),
  advance: Object.freeze({
    keyboard: Object.freeze(['Enter']),
    gamepad: Object.freeze(['BUTTON_START']),
    label: 'Advance / accept the next-scenario hook',
  }),
  reset_profile: Object.freeze({
    keyboard: Object.freeze(['KeyR']),
    gamepad: Object.freeze(['BUTTON_SELECT']),
    label: 'Reset this concept profile to a clean state',
  }),
});

/** Ordered shared verbs, for UI listings and candidate conformance checks. */
export const SHARED_VERBS = Object.freeze(Object.keys(INPUT_MAP));

const RAW_TO_VERB = new Map();
for (const [verb, binding] of Object.entries(INPUT_MAP)) {
  for (const raw of [...binding.keyboard, ...binding.gamepad]) {
    RAW_TO_VERB.set(raw, verb);
  }
}

/**
 * Resolve a raw keyboard code or gamepad button to its shared verb.
 * @param {string} raw
 * @returns {SharedVerb|null} null when the input is unbound (never throws, so a
 *   stray keypress in the shell cannot crash a play session)
 */
export function resolveInput(raw) {
  return RAW_TO_VERB.get(raw) ?? null;
}
