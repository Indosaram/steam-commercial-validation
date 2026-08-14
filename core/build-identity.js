/**
 * Build identity and candidate isolation contract.
 *
 * Architecture finding D4: a single shared BUILD_ID made every candidate's
 * telemetry indistinguishable, which breaks the Task 7 requirement that the
 * comparison table list a build hash per candidate. Finding D3: this workspace
 * has no git boundary, so a commit SHA is unavailable as a build identity.
 *
 * Resolution: build identity is derived from the CONTENT of the modules that
 * define a candidate's behavior, not from VCS state. Each candidate gets:
 *
 *   build_id   foundation-<version>+<concept_id>.<short-hash>
 *   build_hash sha256 over the shared core + that candidate's own sources
 *
 * The shared core hash is a separate field, so Task 7 can prove five builds
 * shared one foundation while still distinguishing each candidate's own code.
 * This works with or without git, which is what D3 requires.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConcept, CONCEPT_IDS } from './concepts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(__dirname, '..');
const CORE_DIR = join(WORKSPACE_DIR, 'core');

export const FOUNDATION_VERSION = '0.1.0';

/** Candidate source lives here once Wave 2 starts: candidates/<concept_id>/ */
export const CANDIDATES_DIR = join(WORKSPACE_DIR, 'candidates');

function hashFiles(files) {
  const h = createHash('sha256');
  // Sort for stability: hash must not depend on directory iteration order.
  for (const file of [...files].sort()) {
    h.update(relative(WORKSPACE_DIR, file));
    h.update('\0');
    h.update(readFileSync(file));
    h.update('\0');
  }
  return h.digest('hex');
}

function listJs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listJs(p));
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Hash of the shared foundation core, identical across all five candidates. */
export function coreHash() {
  return hashFiles(listJs(CORE_DIR));
}

/**
 * Candidate source directory for a concept. Wave 2 builds MUST place their
 * candidate-specific code here so it is captured by the build hash and stays
 * isolated from other candidates.
 */
export function candidateDir(conceptId) {
  getConcept(conceptId);
  return join(CANDIDATES_DIR, conceptId);
}

/**
 * Compute the full build identity for one candidate.
 *
 * @param {string} conceptId
 * @returns {{concept_id: string, build_id: string, build_hash: string,
 *            core_hash: string, candidate_hash: string|null,
 *            candidate_present: boolean, foundation_version: string,
 *            source_files: number}}
 */
export function buildIdentity(conceptId) {
  getConcept(conceptId);

  const core = coreHash();
  const dir = candidateDir(conceptId);
  const candidateFiles = listJs(dir);
  const candidatePresent = candidateFiles.length > 0;
  const candidate = candidatePresent ? hashFiles(candidateFiles) : null;

  // Combined hash binds the concept ID so two candidates with byte-identical
  // (e.g. still-empty) sources can never collide into one build identity.
  const combined = createHash('sha256')
    .update(conceptId)
    .update('\0')
    .update(core)
    .update('\0')
    .update(candidate ?? 'no-candidate-source')
    .digest('hex');

  return {
    concept_id: conceptId,
    build_id: `foundation-${FOUNDATION_VERSION}+${conceptId}.${combined.slice(0, 12)}`,
    build_hash: combined,
    core_hash: core,
    candidate_hash: candidate,
    candidate_present: candidatePresent,
    foundation_version: FOUNDATION_VERSION,
    source_files: candidateFiles.length,
  };
}

/**
 * Candidate isolation check for Wave 2.
 *
 * A candidate must not import another candidate's modules; cross-imports would
 * make the five builds non-independent and corrupt the comparison.
 *
 * @returns {{ok: boolean, violations: string[], checked: number}}
 */
export function checkCandidateIsolation() {
  const violations = [];
  let checked = 0;

  for (const conceptId of CONCEPT_IDS) {
    const dir = candidateDir(conceptId);
    for (const file of listJs(dir)) {
      checked += 1;
      const src = readFileSync(file, 'utf8');
      const importRe = /(?:import\s[^'"]*from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
      let m;
      while ((m = importRe.exec(src)) !== null) {
        const spec = m[1];
        const other = CONCEPT_IDS.find(
          (c) => c !== conceptId && spec.includes(`candidates/${c}`),
        );
        if (other) {
          violations.push(
            `${relative(WORKSPACE_DIR, file)} imports another candidate (${other}) via "${spec}"`,
          );
        }
      }
    }
  }

  return { ok: violations.length === 0, violations, checked };
}

/** Build-identity table for all five concepts (used by Task 7 comparison). */
export function identityTable() {
  return CONCEPT_IDS.map((id) => buildIdentity(id));
}
