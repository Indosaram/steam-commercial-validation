/**
 * Shared-contract regression for candidate scenario + browser game-module loading.
 * The disposable workspace proves that only the active candidate is exposed at
 * /candidate/, while candidates without game.js keep the neutral shell fallback.
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

const FIXTURE_GAME_SOURCE = `
export default function createGame({ canvas, ctx, overlay, concept, scenario, getState, actions, audio, toCanvasPoint, debug }) {
  const marker = 'FIXTURE_MODULAR_GAME';
  return {
    handleVerb() { return false; },
    handlePlayerAction() { return false; },
    destroy() {},
    getDebugState() { return { marker, concept_id: concept.concept_id, steps: scenario.steps.length }; },
  };
}
`;

async function withFixtureCandidate(workspace, fn, { game = true } = {}) {
  const dir = join(workspace, 'candidates', FIXTURE_CONCEPT);
  assert.equal(existsSync(dir), false, `fixture workspace was not empty: ${dir}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scenario.js'), `export default ${JSON.stringify(FIXTURE, null, 2)};\n`, 'utf8');
  if (game) writeFileSync(join(dir, 'game.js'), FIXTURE_GAME_SOURCE, 'utf8');
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
    await new Promise((resolveExit) => child.once('exit', resolveExit));
  }
}

test('a candidate descriptor and game module reach the launched bootstrap surface', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withFixtureCandidate(workspace, async () => {
      await withLaunchedShell(workspace, FIXTURE_CONCEPT, async ({ port, stdoutSoFar }) => {
        const bootstrap = await (await fetch(`http://127.0.0.1:${port}/bootstrap.json`)).json();

        assert.ok(bootstrap.scenario);
        assert.equal(bootstrap.scenario.concept_id, FIXTURE_CONCEPT);
        assert.deepEqual(bootstrap.scenario.steps.map((step) => step.id), FIXTURE.steps.map((step) => step.id));
        assert.deepEqual(bootstrap.scenario.player_actions, FIXTURE.player_actions);
        assert.equal(bootstrap.scenario_source, 'candidate');
        assert.equal(bootstrap.game_module, '/candidate/game.js');

        assert.match(stdoutSoFar(), /scenario\s*:\s*candidate \(6 steps\)/);
        assert.match(stdoutSoFar(), /game\s*:\s*\/candidate\/game\.js/);

        const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
        assert.equal(health.scenario_source, 'candidate');
        assert.equal(health.scenario_steps, 6);
        assert.equal(health.game_module, '/candidate/game.js');

        const gameResponse = await fetch(`http://127.0.0.1:${port}/candidate/game.js`);
        assert.equal(gameResponse.status, 200);
        assert.match(await gameResponse.text(), /FIXTURE_MODULAR_GAME/);

        const traversal = await fetch(
          `http://127.0.0.1:${port}/candidate/%2e%2e%2f${FALLBACK_CONCEPT}%2fgame.js`,
        );
        assert.equal(traversal.status, 403);
      });
    });
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('a concept without scenario.js or game.js serves the neutral blank-shell fallback', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withLaunchedShell(workspace, FALLBACK_CONCEPT, async ({ port, stdoutSoFar }) => {
      const bootstrap = await (await fetch(`http://127.0.0.1:${port}/bootstrap.json`)).json();
      assert.equal(bootstrap.scenario, null);
      assert.equal(bootstrap.scenario_source, 'blank_shell');
      assert.equal(bootstrap.game_module, null);
      assert.equal(bootstrap.concept.concept_id, FALLBACK_CONCEPT);
      assert.match(stdoutSoFar(), /scenario\s*:\s*blank shell/);
      assert.match(stdoutSoFar(), /game\s*:\s*neutral blank-shell fallback/);

      const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
      assert.equal(health.scenario_source, 'blank_shell');
      assert.equal(health.scenario_steps, 0);
      assert.equal(health.game_module, null);

      const gameResponse = await fetch(`http://127.0.0.1:${port}/candidate/game.js`);
      assert.equal(gameResponse.status, 404);
    });
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('a scenario may use the modular host without shipping candidate graphics', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withFixtureCandidate(workspace, async () => {
      await withLaunchedShell(workspace, FIXTURE_CONCEPT, async ({ port }) => {
        const bootstrap = await (await fetch(`http://127.0.0.1:${port}/bootstrap.json`)).json();
        assert.ok(bootstrap.scenario);
        assert.equal(bootstrap.game_module, null);
      });
    }, { game: false });
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('an invalid on-disk descriptor fails the launch by name instead of silently falling back', async () => {
  const workspace = createFoundationWorkspace();
  const dir = join(workspace, 'candidates', FIXTURE_CONCEPT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scenario.js'), 'export default { steps: [{ id: "only", kind: "core_action" }] };\n', 'utf8');
  try {
    const result = await new Promise((resolveExit) => {
      const child = spawn(
        process.execPath,
        [join(workspace, 'tools', 'launch.js'), '--concept', FIXTURE_CONCEPT, '--port', '8299'],
        { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.once('exit', (code) => resolveExit({ code, out, err }));
    });

    assert.equal(result.code, 2, `expected exit 2, got ${result.code}: ${result.err}`);
    assert.match(result.err, /descriptor is invalid/);
    assert.match(result.err, /at least 3/);
    assert.equal(result.out, '');
  } finally {
    removeFoundationWorkspace(workspace);
  }
});

test('the shell dynamically loads one candidate module and contains no concept switchboard', () => {
  const shellSrc = readFileSync(join(WORKSPACE, 'shell', 'shell.js'), 'utf8');
  const fallbackSrc = readFileSync(join(WORKSPACE, 'shell', 'canvas-renderer.js'), 'utf8');
  const combined = `${shellSrc}\n${fallbackSrc}`;

  assert.match(shellSrc, /bootstrap\.scenario/);
  assert.match(shellSrc, /bootstrap\.game_module/);
  assert.match(shellSrc, /import\(bootstrap\.game_module\)/);
  assert.match(shellSrc, /blockedSteps/);
  assert.match(shellSrc, /resolvePlayerAction/);
  assert.match(shellSrc, /resolveInput/);
  assert.match(shellSrc, /from '\/core\/scenario-contract\.js'/);

  for (const conceptId of CONCEPT_IDS) {
    assert.doesNotMatch(combined, new RegExp(conceptId), `shell must not branch on ${conceptId}`);
  }
});

test('the modular host exposes lifecycle, actions, pointer, audio, and QA hooks', () => {
  const shellSrc = readFileSync(join(WORKSPACE, 'shell', 'shell.js'), 'utf8');

  for (const lifecycleMethod of ['handleVerb', 'handlePlayerAction', 'destroy', 'getDebugState']) {
    assert.match(shellSrc, new RegExp(lifecycleMethod));
  }
  for (const action of ['startSession', 'attemptStep', 'completeScenario', 'resetProfile']) {
    assert.match(shellSrc, new RegExp(action));
  }

  assert.match(shellSrc, /setPointerCapture/);
  assert.match(shellSrc, /getBoundingClientRect/);
  assert.match(shellSrc, /AudioContext/);
  assert.match(shellSrc, /createOscillator/);
  assert.match(shellSrc, /createBufferSource/);
  assert.match(shellSrc, /getGameState/);
  assert.match(shellSrc, /scv:statechange/);
  assert.match(
    shellSrc,
    /verb === 'advance'\) return state\.startedAt \? completeScenario/,
    'Enter/advance must start or complete, never auto-complete a pending descriptor step',
  );
});

test('the shared scenario contract remains browser-safe and resolves exact player actions', async () => {
  const src = readFileSync(join(WORKSPACE, 'core', 'scenario-contract.js'), 'utf8');
  assert.doesNotMatch(src, /from '?"?node:/);

  const { resolvePlayerAction } = await import('../core/scenario-contract.js');
  assert.deepEqual(resolvePlayerAction(FIXTURE, 'Digit1'), FIXTURE.player_actions[0]);
  assert.equal(resolvePlayerAction(FIXTURE, 'Space'), null);
  assert.equal(resolvePlayerAction({ steps: FIXTURE.steps }, 'Digit1'), null);
});

test('core/candidate.js still re-exports the contract helpers for Node consumers', async () => {
  const mod = await import('../core/candidate.js');
  for (const name of ['validateDescriptor', 'blockedSteps', 'STEP_KINDS']) {
    assert.equal(typeof mod[name] !== 'undefined', true, `core/candidate.js must still export ${name}`);
  }
});

test('descriptor prerequisites define the named blocked state the host must show', () => {
  const blocked = blockedSteps(FIXTURE, ['survey']);
  const reveal = blocked.find((entry) => entry.id === 'reveal');
  assert.ok(reveal);
  assert.deepEqual(reveal.missing, ['sort_3']);
  assert.equal(blockedSteps(FIXTURE, FIXTURE.replay).length, 0);
});

test('the shared integration fixture does not leak candidate content', async () => {
  const workspace = createFoundationWorkspace();
  try {
    await withFixtureCandidate(workspace, async () => {});
    assert.equal(existsSync(join(workspace, 'candidates', FIXTURE_CONCEPT)), false);
  } finally {
    removeFoundationWorkspace(workspace);
  }
});
