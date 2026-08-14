/**
 * Shared-contract regression: a candidate's own scenario.js must actually reach
 * the launched surface.
 *
 * The foundation shipped the loader (core/candidate.js) but nothing consumed
 * it: tools/launch.js served only the generic concept card and shell/shell.js
 * rendered a hardcoded beat list. A Wave 2 worker could therefore write a
 * perfectly valid descriptor and see zero change in the browser, which silently
 * breaks the whole "each candidate owns exactly one directory" contract.
 *
 * These tests plant a fixture descriptor in the real candidates/ tree, launch
 * the real launcher on an ephemeral port, and assert the descriptor is visible
 * in /bootstrap.json and drives ordered gating - while a concept WITHOUT a
 * descriptor still boots the valid blank-shell fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONCEPT_IDS } from '../core/concepts.js';
import { blockedSteps } from '../core/candidate.js';
import {
  createFoundationWorkspace,
  removeFoundationWorkspace,
} from './test-workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, '..');

const FIXTURE_CONCEPT = 'fake_it_till_you_clean_it';
const FALLBACK_CONCEPT = 'cursed_secondhand';

/** A conforming descriptor with content no generic shell could invent. */
const FIXTURE = {
  concept_id: FIXTURE_CONCEPT,
  steps: [
    { id: 'survey', kind: 'inspect', label: 'FIXTURE survey the blocked lane' },
    {
      id: 'sort_1',
      kind: 'core_action',
      label: 'FIXTURE sort parcel 1',
      requires: ['survey'],
      transformation: { before: 'fixture_blocked_lane', after: 'fixture_lane_partially_clear' },
    },
    { id: 'sort_2', kind: 'core_action', label: 'FIXTURE sort parcel 2', requires: ['sort_1'] },
    { id: 'sort_3', kind: 'core_action', label: 'FIXTURE sort parcel 3', requires: ['sort_2'] },
    { id: 'reveal', kind: 'reveal', label: 'FIXTURE recurring recipient', requires: ['sort_3'] },
    { id: 'decide', kind: 'choice', label: 'FIXTURE commit priority', requires: ['reveal'] },
  ],
  replay: ['survey', 'sort_1', 'sort_2', 'sort_3', 'reveal', 'decide'],
  player_actions: [
    {
      id: 'probe_sort_3',
      step_id: 'sort_3',
      keyboard: ['Digit1'],
      label: 'FIXTURE attempt sort parcel 3',
    },
  ],
};

/** Plant a descriptor only in the disposable foundation workspace. */
async function withFixtureDescriptor(workspace, fn) {
  const dir = join(workspace, 'candidates', FIXTURE_CONCEPT);
  const file = join(dir, 'scenario.js');
  assert.equal(existsSync(dir), false, `fixture workspace was not empty: ${dir}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `export default ${JSON.stringify(FIXTURE, null, 2)};\n`, 'utf8');
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Launch the copied real launcher on an ephemeral port and await its readiness line. */
async function withLaunchedShell(workspace, conceptId, fn) {
  const launch = join(workspace, 'tools', 'launch.js');
  const port = 8300 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [launch, '--concept', conceptId, '--port', String(port)], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  try {
    // Wait for the launcher's own readiness signal - no fixed sleep.
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error(`launcher never became ready: ${stderr || stdout}`)), 10000);
      timer.unref();
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes(`http://127.0.0.1:${port}/`)) {
          clearTimeout(timer);
          resolveReady();
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('exit', (code) => {
        clearTimeout(timer);
        rejectReady(new Error(`launcher exited early (${code}): ${stderr || stdout}`));
      });
    });

    return await fn({ port, stdoutSoFar: () => stdout });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
}

// ------------------------------------------------- launch/bootstrap surface

test('a candidate descriptor reaches the launched bootstrap surface', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withFixtureDescriptor(workspace, async () => {
      await withLaunchedShell(workspace, FIXTURE_CONCEPT, async ({ port, stdoutSoFar }) => {
        const bootstrap = await (await fetch(`http://127.0.0.1:${port}/bootstrap.json`)).json();

        assert.ok(bootstrap.scenario, '/bootstrap.json must carry the candidate scenario descriptor');
        assert.equal(bootstrap.scenario.concept_id, FIXTURE_CONCEPT);
        assert.deepEqual(
          bootstrap.scenario.steps.map((s) => s.id),
          FIXTURE.steps.map((s) => s.id),
          'bootstrap must expose the descriptor step order verbatim',
        );
        assert.equal(bootstrap.scenario.steps[0].label, 'FIXTURE survey the blocked lane');
        assert.deepEqual(bootstrap.scenario.player_actions, FIXTURE.player_actions);
        assert.deepEqual(bootstrap.scenario.steps[1].transformation, {
          before: 'fixture_blocked_lane',
          after: 'fixture_lane_partially_clear',
        });
        assert.equal(bootstrap.scenario_source, 'candidate');

        // Launch stdout must say the descriptor was loaded, so an operator can
        // tell a candidate build from the blank shell without opening a browser.
        assert.match(stdoutSoFar(), /scenario\s*:\s*candidate \(6 steps\)/);

        const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
        assert.equal(health.scenario_source, 'candidate');
        assert.equal(health.scenario_steps, 6);
      });
    });
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('a concept without a descriptor still serves a valid blank shell', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withLaunchedShell(workspace, FALLBACK_CONCEPT, async ({ port, stdoutSoFar }) => {
      const bootstrap = await (await fetch(`http://127.0.0.1:${port}/bootstrap.json`)).json();
      assert.equal(bootstrap.scenario, null, 'no descriptor means no scenario in bootstrap');
      assert.equal(bootstrap.scenario_source, 'blank_shell');
      assert.equal(bootstrap.concept.concept_id, FALLBACK_CONCEPT);
      assert.match(stdoutSoFar(), /scenario\s*:\s*blank shell/);

      const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
      assert.equal(health.scenario_source, 'blank_shell');
      assert.equal(health.scenario_steps, 0);
    });
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('an invalid on-disk descriptor fails the launch by name instead of silently falling back', async () => {
  const workspace = createFoundationWorkspace();
  const dir = join(workspace, 'candidates', FIXTURE_CONCEPT);
  const file = join(dir, 'scenario.js');
  mkdirSync(dir, { recursive: true });
  // Only one core_action: violates the shared success condition.
  writeFileSync(
    file,
    'export default { steps: [{ id: "only", kind: "core_action" }] };\n',
    'utf8',
  );
  try {
    const result = await new Promise((resolveExit) => {
      const child = spawn(
        process.execPath,
        [join(workspace, 'tools', 'launch.js'), '--concept', FIXTURE_CONCEPT, '--port', '8299'],
        { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.once('exit', (code) => resolveExit({ code, out, err }));
    });

    assert.equal(result.code, 2, `expected exit 2, got ${result.code}: ${result.err}`);
    assert.match(result.err, /descriptor is invalid/);
    assert.match(result.err, /at least 3/);
    assert.equal(result.out, '', 'a rejected launch must not announce a ready URL');
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

// ------------------------------------------------------ browser shell wiring

test('the browser shell consumes the descriptor instead of a hardcoded beat list', () => {
  const shellSrc = readFileSync(join(WORKSPACE, 'shell', 'shell.js'), 'utf8');

  assert.match(
    shellSrc,
    /bootstrap\.scenario/,
    'shell.js must read the scenario descriptor delivered by /bootstrap.json',
  );
  assert.match(
    shellSrc,
    /blockedSteps/,
    'shell.js must reuse the shared blockedSteps() gate rather than reimplementing prerequisites',
  );
  assert.match(
    shellSrc,
    /resolvePlayerAction/,
    'shell.js must resolve descriptor-authored player actions to exact steps',
  );
  // The gate must come from the shared contract module, not a browser-local copy.
  assert.match(
    shellSrc,
    /from '\/core\/scenario-contract\.js'/,
    'shell.js must import the shared scenario contract served by the launcher',
  );
});

test('the shared scenario contract is importable without node builtins (browser-safe)', async () => {
  const src = readFileSync(join(WORKSPACE, 'core', 'scenario-contract.js'), 'utf8');
  assert.doesNotMatch(src, /from '?"?node:/, 'the browser-served contract module must not import node builtins');

  const { resolvePlayerAction } = await import('../core/scenario-contract.js');
  assert.deepEqual(
    resolvePlayerAction(FIXTURE, 'Digit1'),
    FIXTURE.player_actions[0],
    'an explicit physical player action must select its exact authored step',
  );
  assert.equal(resolvePlayerAction(FIXTURE, 'Space'), null, 'shared verb keys remain owned by the shared input map');
  assert.equal(resolvePlayerAction({ steps: FIXTURE.steps }, 'Digit1'), null, 'descriptors without actions keep old semantics');
});

test('core/candidate.js still re-exports the contract helpers for Node consumers', async () => {
  const mod = await import('../core/candidate.js');
  for (const name of ['validateDescriptor', 'blockedSteps', 'STEP_KINDS']) {
    assert.equal(typeof mod[name] !== 'undefined', true, `core/candidate.js must still export ${name}`);
  }
});

// --------------------------------------------------------- gating semantics

test('descriptor prerequisites define the named blocked state the shell must show', () => {
  const blocked = blockedSteps(FIXTURE, ['survey']);
  const reveal = blocked.find((b) => b.id === 'reveal');
  assert.ok(reveal, 'reveal must be blocked before its prerequisites are met');
  assert.deepEqual(reveal.missing, ['sort_3']);
  assert.equal(blockedSteps(FIXTURE, FIXTURE.replay).length, 0);
});

test('the shared integration does not add candidate content', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withFixtureDescriptor(workspace, async () => {});
    assert.equal(
      existsSync(join(workspace, 'candidates', FIXTURE_CONCEPT)),
      false,
      `${FIXTURE_CONCEPT} fixture leaked candidate content`,
    );
  } finally {
    removeFoundationWorkspace(workspace);
  }
});
