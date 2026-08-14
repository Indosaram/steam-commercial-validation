import test from 'node:test';
import assert from 'node:assert/strict';

import { CONCEPT_IDS } from '../core/concepts.js';
import {
  buildIdentity,
  identityTable,
  coreHash,
  checkCandidateIsolation,
  candidateDir,
  FOUNDATION_VERSION,
} from '../core/build-identity.js';
import { runScenario } from '../core/shell-core.js';
import { validateSession } from '../core/telemetry.js';
import {
  createFoundationWorkspace,
  importWorkspaceModule,
  removeFoundationWorkspace,
} from './test-workspace.js';

// Architecture finding D4: five candidates must never share one build_id.

test('every concept gets a distinct build_id', () => {
  const ids = CONCEPT_IDS.map((c) => buildIdentity(c).build_id);
  assert.equal(new Set(ids).size, CONCEPT_IDS.length, `build_ids collided: ${ids.join(', ')}`);
});

test('every concept gets a distinct build_hash', () => {
  const hashes = CONCEPT_IDS.map((c) => buildIdentity(c).build_hash);
  assert.equal(new Set(hashes).size, CONCEPT_IDS.length, 'build_hash collision across candidates');
});

test('build_id embeds the concept id and the foundation version', () => {
  for (const id of CONCEPT_IDS) {
    const identity = buildIdentity(id);
    assert.ok(identity.build_id.includes(id), `${identity.build_id} missing concept id`);
    assert.ok(identity.build_id.startsWith(`foundation-${FOUNDATION_VERSION}+`), identity.build_id);
  }
});

test('all candidates share one core hash', () => {
  const core = coreHash();
  for (const id of CONCEPT_IDS) {
    assert.equal(buildIdentity(id).core_hash, core, `${id} core hash drifted`);
  }
});

test('build identity is stable across repeated computation', () => {
  for (const id of CONCEPT_IDS) {
    assert.equal(buildIdentity(id).build_hash, buildIdentity(id).build_hash);
  }
});

test('emitted telemetry carries the per-candidate build_id, not a shared one', () => {
  const buildIds = new Set();
  for (const id of CONCEPT_IDS) {
    const s = runScenario({ conceptId: id, seed: 1 });
    const expected = buildIdentity(id).build_id;
    assert.equal(s.build_id, expected);
    for (const ev of s.events) {
      assert.equal(ev.build_id, expected, `${id} event ${ev.event} has wrong build_id`);
    }
    buildIds.add(s.build_id);
    assert.equal(validateSession(s.events).ok, true, `${id} session must still validate`);
  }
  assert.equal(buildIds.size, CONCEPT_IDS.length, 'telemetry build_ids are not unique per candidate');
});

test('identity table covers all five concepts', () => {
  const table = identityTable();
  assert.equal(table.length, 5);
  assert.deepEqual(table.map((r) => r.concept_id), [...CONCEPT_IDS]);
});

test('candidate directories are isolated per concept', () => {
  const dirs = CONCEPT_IDS.map((c) => candidateDir(c));
  assert.equal(new Set(dirs).size, CONCEPT_IDS.length);
  for (const id of CONCEPT_IDS) {
    assert.ok(candidateDir(id).endsWith(`candidates/${id}`), candidateDir(id));
  }
});

test('candidate isolation check passes on the empty foundation', () => {
  const r = checkCandidateIsolation();
  assert.equal(r.ok, true, `isolation violations: ${r.violations.join('; ')}`);
});

test('a concept without candidate source has an empty candidate identity', async () => {
  const workspace = createFoundationWorkspace();
  try {
    const isolated = await importWorkspaceModule(workspace, 'core/build-identity.js');
    const identity = isolated.buildIdentity('cursed_secondhand');
    assert.equal(identity.candidate_present, false);
    assert.equal(identity.candidate_hash, null);
    assert.equal(identity.source_files, 0);
  } finally {
    removeFoundationWorkspace(workspace);
  }
});
