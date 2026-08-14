/**
 * Per-concept save/reset behavior.
 *
 * Rules the plan requires:
 *  - a launch creates a new profile when none exists
 *  - a corrupted profile must recover into a clean profile, never soft-lock
 *  - a profile written by an older schema version must be reset, not trusted
 *  - reset must clear progress while keeping the concept binding
 *
 * Profiles are small JSON files under <root>/<concept_id>.json. There is no
 * cloud sync, no account, and no marketplace state by design.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { getConcept } from './concepts.js';

export const PROFILE_VERSION = 1;

/** @param {{root: string, conceptId: string}} args */
function profilePath({ root, conceptId }) {
  return join(root, `${conceptId}.json`);
}

/** @param {string} conceptId */
function blankProfile(conceptId) {
  return {
    version: PROFILE_VERSION,
    concept_id: conceptId,
    created_at: null, // filled at write time; kept null in the template for determinism
    sessions_started: 0,
    sessions_completed: 0,
    last_session_id: null,
    scenario_state: {},
  };
}

/**
 * Create (or overwrite) a clean profile for a concept.
 * @param {{root: string, conceptId: string, now?: () => string}} args
 */
export function createProfile({ root, conceptId, now = () => new Date().toISOString() }) {
  getConcept(conceptId); // rejects missing/unknown concept_id
  mkdirSync(root, { recursive: true });
  const path = profilePath({ root, conceptId });
  const profile = { ...blankProfile(conceptId), created_at: now() };
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  return { ...profile, path, recovered: false, recovery_reason: null };
}

/**
 * Load a profile, healing anything unusable into a clean profile.
 *
 * Never throws for bad on-disk data: a corrupted save must not prevent the
 * owner from launching the build. The `recovered` flag lets the shell surface
 * an honest "your profile was reset" message instead of silently lying.
 *
 * @param {{root: string, conceptId: string, now?: () => string}} args
 */
export function loadProfile({ root, conceptId, now = () => new Date().toISOString() }) {
  getConcept(conceptId);
  const path = profilePath({ root, conceptId });

  if (!existsSync(path)) {
    const created = createProfile({ root, conceptId, now });
    return { ...created, recovered: false, recovery_reason: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    const healed = createProfile({ root, conceptId, now });
    return { ...healed, recovered: true, recovery_reason: 'corrupt_profile' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const healed = createProfile({ root, conceptId, now });
    return { ...healed, recovered: true, recovery_reason: 'corrupt_profile' };
  }

  if (parsed.version !== PROFILE_VERSION) {
    const healed = createProfile({ root, conceptId, now });
    return { ...healed, recovered: true, recovery_reason: 'version_mismatch' };
  }

  if (parsed.concept_id !== conceptId) {
    const healed = createProfile({ root, conceptId, now });
    return { ...healed, recovered: true, recovery_reason: 'concept_mismatch' };
  }

  // Structural repair of individual fields, so a partially-written profile
  // degrades to defaults rather than crashing the shell mid-session.
  const template = blankProfile(conceptId);
  const repaired = { ...template, ...parsed };
  let fieldRepair = false;
  for (const key of ['sessions_started', 'sessions_completed']) {
    if (!Number.isInteger(repaired[key]) || repaired[key] < 0) {
      repaired[key] = 0;
      fieldRepair = true;
    }
  }
  if (repaired.scenario_state === null || typeof repaired.scenario_state !== 'object' || Array.isArray(repaired.scenario_state)) {
    repaired.scenario_state = {};
    fieldRepair = true;
  }

  if (fieldRepair) {
    writeFileSync(path, `${JSON.stringify(repaired, null, 2)}\n`, 'utf8');
    return { ...repaired, path, recovered: true, recovery_reason: 'field_repair' };
  }

  return { ...repaired, path, recovered: false, recovery_reason: null };
}

/**
 * Reset a concept profile to a clean state, keeping the concept binding.
 * @param {{root: string, conceptId: string, now?: () => string}} args
 */
export function resetProfile({ root, conceptId, now = () => new Date().toISOString() }) {
  getConcept(conceptId);
  const created = createProfile({ root, conceptId, now });
  return { ...created, recovered: false, recovery_reason: null };
}

/**
 * Persist an updated profile. Writes through a temp file so an interrupt
 * mid-write cannot leave a half-written JSON document on disk.
 * @param {{root: string, conceptId: string, profile: object}} args
 */
export function saveProfile({ root, conceptId, profile }) {
  getConcept(conceptId);
  mkdirSync(root, { recursive: true });
  const path = profilePath({ root, conceptId });
  const tmp = `${path}.tmp`;
  const toWrite = { ...profile };
  delete toWrite.path;
  delete toWrite.recovered;
  delete toWrite.recovery_reason;
  writeFileSync(tmp, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
  // rename is atomic within a filesystem; readers see old or new, never partial
  renameSync(tmp, path);
  return { ...toWrite, path };
}

/** Remove a concept profile entirely (used by cleanup/reset tooling). */
export function deleteProfile({ root, conceptId }) {
  getConcept(conceptId);
  const path = profilePath({ root, conceptId });
  rmSync(path, { force: true });
  return { path, deleted: true };
}
