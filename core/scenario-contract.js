/**
 * Browser-safe candidate scenario contract.
 *
 * This module deliberately has no Node imports so the launcher, browser shell,
 * tests, and candidate loader all use one validation and prerequisite gate.
 */

import { INPUT_MAP } from './input.js';

const RESERVED_PLAYER_INPUTS = new Set(
  Object.values(INPUT_MAP).flatMap((binding) => [...binding.keyboard, ...binding.gamepad]),
);

/** Step kinds a candidate may declare, mapped to the shared required events. */
export const STEP_KINDS = Object.freeze({
  inspect: 'inspect_performed',
  core_action: 'core_action_completed',
  reveal: 'signature_reveal_seen',
  choice: 'choice_committed',
});

/**
 * Validate a candidate descriptor against the shared contract.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDescriptor(descriptor, conceptId) {
  const errors = [];

  if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return { ok: false, errors: ['descriptor must be an object'] };
  }

  if (descriptor.concept_id !== undefined && descriptor.concept_id !== conceptId) {
    errors.push(
      `descriptor concept_id "${descriptor.concept_id}" does not match its directory (${conceptId})`,
    );
  }

  const steps = descriptor.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, errors: [...errors, 'descriptor.steps must be a non-empty array'] };
  }

  const ids = new Set();
  steps.forEach((step, i) => {
    const at = `steps[${i}]`;
    if (!step || typeof step !== 'object') {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof step.id !== 'string' || step.id.trim() === '') errors.push(`${at}.id must be a non-empty string`);
    else if (ids.has(step.id)) errors.push(`${at}.id duplicates "${step.id}"`);
    else ids.add(step.id);

    if (!Object.prototype.hasOwnProperty.call(STEP_KINDS, step.kind)) {
      errors.push(`${at}.kind "${step.kind}" must be one of: ${Object.keys(STEP_KINDS).join(', ')}`);
    }
    if (step.duration_ms !== undefined && (!Number.isFinite(step.duration_ms) || step.duration_ms < 0)) {
      errors.push(`${at}.duration_ms must be a non-negative number`);
    }
    if (step.requires !== undefined && !Array.isArray(step.requires)) {
      errors.push(`${at}.requires must be an array of step ids`);
    }
    if (step.transformation !== undefined) {
      const t = step.transformation;
      if (!t || typeof t !== 'object' || Array.isArray(t)) errors.push(`${at}.transformation must be an object`);
      else if (t.before === undefined || t.after === undefined) {
        errors.push(`${at}.transformation needs both before and after (visible transformation proof)`);
      }
    }
  });

  const order = steps.map((s) => s?.id);
  steps.forEach((step, i) => {
    for (const req of step?.requires ?? []) {
      const idx = order.indexOf(req);
      if (idx === -1) errors.push(`steps[${i}].requires unknown step "${req}"`);
      else if (idx >= i) errors.push(`steps[${i}].requires "${req}" which is not an earlier step (soft-lock)`);
    }
  });

  const kinds = steps.map((s) => s?.kind);
  const coreCount = kinds.filter((k) => k === 'core_action').length;
  if (coreCount < 3) errors.push(`descriptor declares ${coreCount} core_action steps; the shared contract requires at least 3`);
  if (!kinds.includes('reveal')) errors.push('descriptor is missing a reveal step (signature_reveal_seen)');
  if (!kinds.includes('choice')) errors.push('descriptor is missing a choice step (choice_committed)');

  if (descriptor.replay !== undefined) {
    if (!Array.isArray(descriptor.replay)) errors.push('descriptor.replay must be an array of step ids');
    else {
      for (const id of descriptor.replay) {
        if (!ids.has(id)) errors.push(`descriptor.replay references unknown step "${id}"`);
      }
    }
  }

  if (descriptor.player_actions !== undefined) {
    if (!Array.isArray(descriptor.player_actions)) errors.push('descriptor.player_actions must be an array');
    else {
      const actionIds = new Set();
      const inputs = new Set();
      descriptor.player_actions.forEach((action, i) => {
        const at = `player_actions[${i}]`;
        if (!action || typeof action !== 'object' || Array.isArray(action)) {
          errors.push(`${at} must be an object`);
          return;
        }
        if (typeof action.id !== 'string' || action.id.trim() === '') errors.push(`${at}.id must be a non-empty string`);
        else if (actionIds.has(action.id)) errors.push(`${at}.id duplicates "${action.id}"`);
        else actionIds.add(action.id);

        if (typeof action.step_id !== 'string' || !ids.has(action.step_id)) {
          errors.push(`${at}.step_id references unknown step "${action.step_id}"`);
        }
        if (!Array.isArray(action.keyboard) || action.keyboard.length === 0) {
          errors.push(`${at}.keyboard must be a non-empty array`);
        } else {
          for (const raw of action.keyboard) {
            if (typeof raw !== 'string' || raw.trim() === '') errors.push(`${at}.keyboard entries must be non-empty strings`);
            else if (RESERVED_PLAYER_INPUTS.has(raw)) errors.push(`${at}.keyboard uses reserved shared input "${raw}"`);
            else if (inputs.has(raw)) errors.push(`${at}.keyboard duplicates player input "${raw}"`);
            else inputs.add(raw);
          }
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Resolve a descriptor-authored physical input to its exact candidate step. */
export function resolvePlayerAction(descriptor, rawInput) {
  return (descriptor?.player_actions ?? []).find((action) => action.keyboard.includes(rawInput)) ?? null;
}

/** Resolve incomplete steps whose declared prerequisites have not been met. */
export function blockedSteps(descriptor, completedIds = []) {
  const done = new Set(completedIds);
  return (descriptor.steps ?? [])
    .filter((s) => !done.has(s.id))
    .filter((s) => (s.requires ?? []).some((r) => !done.has(r)))
    .map((s) => ({
      id: s.id,
      missing: (s.requires ?? []).filter((r) => !done.has(r)),
    }));
}
