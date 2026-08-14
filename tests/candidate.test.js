import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONCEPT_IDS } from '../core/concepts.js';
import {
  validateDescriptor,
  descriptorPath,
  blockedSteps,
  STEP_KINDS,
} from '../core/candidate.js';
import {
  createFoundationWorkspace,
  importWorkspaceModule,
  removeFoundationWorkspace,
} from './test-workspace.js';

/** A minimal descriptor that satisfies the shared contract. */
function goodDescriptor(conceptId = 'return_to_sender') {
  return {
    concept_id: conceptId,
    steps: [
      { id: 'survey', kind: 'inspect', label: 'Survey the blocked lane' },
      {
        id: 'sort_1',
        kind: 'core_action',
        label: 'Sort parcel 1',
        requires: ['survey'],
        transformation: { before: 'blocked_lane', after: 'lane_partially_clear' },
      },
      { id: 'sort_2', kind: 'core_action', label: 'Sort parcel 2', requires: ['sort_1'] },
      { id: 'sort_3', kind: 'core_action', label: 'Sort parcel 3', requires: ['sort_2'] },
      { id: 'reveal', kind: 'reveal', label: 'Recurring recipient', requires: ['sort_3'] },
      { id: 'decide', kind: 'choice', label: 'Commit priority', requires: ['reveal'] },
    ],
    replay: ['survey', 'sort_1', 'sort_2', 'sort_3', 'reveal', 'decide'],
  };
}

test('a concept without candidate content uses the blank shell', async () => {
  const workspace = createFoundationWorkspace();
  try {
    const { hasCandidateScenario, loadCandidateScenario } = await importWorkspaceModule(
      workspace,
      'core/candidate.js',
    );
    const conceptId = 'cursed_secondhand';
    assert.equal(hasCandidateScenario(conceptId), false);
    assert.equal(await loadCandidateScenario(conceptId), null);
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('each candidate owns a distinct descriptor path under its own directory', () => {
  const paths = CONCEPT_IDS.map((c) => descriptorPath(c));
  assert.equal(new Set(paths).size, CONCEPT_IDS.length);
  for (const id of CONCEPT_IDS) {
    assert.ok(descriptorPath(id).endsWith(`candidates/${id}/scenario.js`));
  }
});

test('a conforming descriptor validates', () => {
  const r = validateDescriptor(goodDescriptor(), 'return_to_sender');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('a descriptor with fewer than three core actions is rejected', () => {
  const d = goodDescriptor();
  d.steps = d.steps.filter((s) => s.id !== 'sort_3');
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('at least 3')), JSON.stringify(r.errors));
});

test('a descriptor missing the signature reveal is rejected', () => {
  const d = goodDescriptor();
  d.steps = d.steps.filter((s) => s.kind !== 'reveal');
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('reveal')));
});

test('a descriptor missing the meaningful choice is rejected', () => {
  const d = goodDescriptor();
  d.steps = d.steps.filter((s) => s.kind !== 'choice');
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('choice')));
});

test('a forward prerequisite is rejected as a soft-lock', () => {
  const d = goodDescriptor();
  d.steps[0].requires = ['decide']; // survey requires a later step
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /soft-lock/.test(e)), JSON.stringify(r.errors));
});

test('an unknown prerequisite is rejected', () => {
  const d = goodDescriptor();
  d.steps[1].requires = ['does_not_exist'];
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('does_not_exist')));
});

test('a transformation missing before/after is rejected', () => {
  const d = goodDescriptor();
  d.steps[1].transformation = { before: 'blocked' };
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('transformation')));
});

test('a descriptor whose concept_id contradicts its directory is rejected', () => {
  const r = validateDescriptor(goodDescriptor('cursed_secondhand'), 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('does not match its directory')));
});

test('duplicate step ids are rejected', () => {
  const d = goodDescriptor();
  d.steps[2].id = 'sort_1';
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('duplicates')));
});

test('an unknown step kind is rejected', () => {
  const d = goodDescriptor();
  d.steps[0].kind = 'buy_lootbox';
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('buy_lootbox')));
});

test('replay referencing an unknown step is rejected', () => {
  const d = goodDescriptor();
  d.replay = ['survey', 'ghost_step'];
  const r = validateDescriptor(d, 'return_to_sender');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('ghost_step')));

  const cases = [
    [{ id: 'probe', step_id: 'sort_3', keyboard: 'Digit1' }, /keyboard must be a non-empty array/],
    [{ id: 'probe', step_id: 'missing', keyboard: ['Digit1'] }, /unknown step "missing"/],
    [{ id: 'probe', step_id: 'sort_3', keyboard: ['Space'] }, /reserved shared input "Space"/],
  ];
  for (const [action, expected] of cases) {
    const descriptor = goodDescriptor();
    descriptor.player_actions = [action];
    const result = validateDescriptor(descriptor, 'return_to_sender');
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), expected);
  }

  const duplicate = goodDescriptor();
  duplicate.player_actions = [
    { id: 'probe_a', step_id: 'sort_2', keyboard: ['Digit1'] },
    { id: 'probe_b', step_id: 'sort_3', keyboard: ['Digit1'] },
  ];
  const duplicateResult = validateDescriptor(duplicate, 'return_to_sender');
  assert.equal(duplicateResult.ok, false);
  assert.match(duplicateResult.errors.join('\n'), /duplicates player input "Digit1"/);
});

test('step kinds map onto the shared required events', () => {
  assert.equal(STEP_KINDS.core_action, 'core_action_completed');
  assert.equal(STEP_KINDS.reveal, 'signature_reveal_seen');
  assert.equal(STEP_KINDS.choice, 'choice_committed');
});

test('blockedSteps reports the exact missing prerequisites', () => {
  const d = goodDescriptor();
  const blocked = blockedSteps(d, ['survey']);
  const reveal = blocked.find((b) => b.id === 'reveal');
  assert.ok(reveal, 'reveal should be blocked');
  assert.deepEqual(reveal.missing, ['sort_3']);

  const done = ['survey', 'sort_1', 'sort_2', 'sort_3', 'reveal'];
  assert.equal(blockedSteps(d, done).length, 0, 'nothing blocked once prerequisites are met');
});

test('a real on-disk candidate descriptor loads without editing shared code', async () => {
  // Proves the Wave 2 workflow: a worker drops scenario.js into their own
  // directory and the foundation picks it up with no core/shell/tools edit.
  const root = mkdtempSync(join(tmpdir(), 'scv-cand-'));
  try {
    const dir = join(root, 'candidates', 'return_to_sender');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'scenario.js');
    writeFileSync(file, `export default ${JSON.stringify(goodDescriptor(), null, 2)};\n`, 'utf8');

    const mod = await import(pathToFileURL(file).href);
    const check = validateDescriptor(mod.default, 'return_to_sender');
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.equal(mod.default.steps.filter((s) => s.kind === 'core_action').length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
