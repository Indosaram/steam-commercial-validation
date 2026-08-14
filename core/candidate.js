/**
 * Candidate extension point for Wave 2 (Tasks 2-6).
 *
 * Each candidate owns exactly one directory:
 *
 *   candidates/<concept_id>/scenario.js
 *
 * ...which default-exports a scenario descriptor. A candidate worker adds
 * visible transformation, invalid-path gating, and replay data there WITHOUT
 * editing core/, shell/, or tools/. That isolation is what keeps five parallel
 * builds comparable and keeps build hashes meaningful per candidate.
 *
 * The foundation ships zero candidate descriptors: the blank shell falls back
 * to the generic beat structure when no descriptor is present.
 *
 * Descriptor shape (all fields optional except `steps`):
 *
 *   export default {
 *     concept_id: 'return_to_sender',
 *     steps: [                      // ordered scenario beats
 *       { id, kind, label,          // kind: core_action | reveal | choice | inspect
 *         requires: ['step_id'],    // invalid-path gating: prerequisites
 *         transformation: {         // visible before/after state
 *           before: 'blocked_lane', after: 'cleared_lane' },
 *         duration_ms: 110000 },
 *     ],
 *     replay: ['step_id', ...],     // deterministic replay-driver ordering
 *     player_actions: [{            // optional exact-step browser controls
 *       id, step_id, keyboard: ['Digit1'], label,
 *     }],
 *   }
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getConcept } from './concepts.js';
import { candidateDir } from './build-identity.js';
import { validateDescriptor } from './scenario-contract.js';

export { STEP_KINDS, validateDescriptor, blockedSteps, resolvePlayerAction } from './scenario-contract.js';

/** Path of a candidate's scenario descriptor module. */
export function descriptorPath(conceptId) {
  getConcept(conceptId);
  return join(candidateDir(conceptId), 'scenario.js');
}

/** True when a candidate has supplied its own scenario descriptor. */
export function hasCandidateScenario(conceptId) {
  return existsSync(descriptorPath(conceptId));
}

/**
 * Load and validate a candidate's scenario descriptor.
 * Returns null when the candidate has not supplied one (blank-shell fallback).
 *
 * @returns {Promise<object|null>}
 * @throws {Error} when a descriptor exists but violates the shared contract
 */
export async function loadCandidateScenario(conceptId) {
  getConcept(conceptId);
  if (!hasCandidateScenario(conceptId)) return null;

  const url = pathToFileURL(descriptorPath(conceptId)).href;
  const mod = await import(url);
  const descriptor = mod.default ?? mod.scenario ?? null;

  if (!descriptor) {
    throw new Error(`candidate ${conceptId}: scenario.js must default-export a descriptor`);
  }

  const check = validateDescriptor(descriptor, conceptId);
  if (!check.ok) {
    throw new Error(`candidate ${conceptId} descriptor is invalid:\n  - ${check.errors.join('\n  - ')}`);
  }

  return { ...descriptor, concept_id: conceptId };
}

