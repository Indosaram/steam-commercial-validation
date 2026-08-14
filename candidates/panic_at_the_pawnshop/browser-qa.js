#!/usr/bin/env node
/** Real-Chrome/CDP QA for PANIC! AT THE PAWNSHOP. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import descriptor from './scenario.js';

const CONCEPT_ID = 'panic_at_the_pawnshop';
const KEY_FOR_KIND = Object.freeze({
  inspect: 'KeyE',
  core_action: 'Space',
  reveal: 'KeyQ',
  choice: 'KeyF',
});

function parseArgs(argv) {
  const args = { port: 8177, cdp: 9222, invalidFirst: false, staleProfile: false, captureDir: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--cdp') args.cdp = Number(argv[++i]);
    else if (arg === '--invalid-first') args.invalidFirst = true;
    else if (arg === '--stale-profile') args.staleProfile = true;
    else if (arg === '--capture-dir') args.captureDir = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.port) || !Number.isInteger(args.cdp)) {
    throw new Error('--port and --cdp must be integers');
  }
  return args;
}

class Cdp {
  static async attach(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect: ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      timer.unref?.();
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async key(code) {
    const keys = { Space: ' ', Enter: 'Enter', KeyQ: 'q', KeyF: 'f', KeyE: 'e' };
    const virtual = { Space: 32, Enter: 13, KeyQ: 81, KeyF: 70, KeyE: 69 };
    const fields = { code, key: keys[code], windowsVirtualKeyCode: virtual[code] };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...fields });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...fields });
  }

  async screenshot(path) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(result.data, 'base64'));
  }

  close() { this.ws.close(); }
}

async function waitFor(cdp, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await cdp.eval(expression);
      if (last) return last;
    } catch { /* navigation is still settling */ }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

const STATE = 'JSON.stringify({status:document.getElementById("status").textContent,'
  + 'events:window.__scv.getState().events.length,'
  + 'completed:window.__scv.getState().completedSteps,'
  + 'finished:window.__scv.getState().finished})';

async function main() {
  const args = parseArgs(process.argv);
  if (args.captureDir) mkdirSync(args.captureDir, { recursive: true });

  const failures = [];
  const timeline = [];
  const evidence = [];
  const outcomes = [];
  const captures = [];
  const pageUrl = `http://127.0.0.1:${args.port}/`;
  const tabResponse = await fetch(
    `http://127.0.0.1:${args.cdp}/json/new?${encodeURIComponent(pageUrl)}`,
    { method: 'PUT' },
  );
  if (!tabResponse.ok) throw new Error(`CDP tab creation failed: HTTP ${tabResponse.status}`);
  const tab = await tabResponse.json();
  const cdp = await Cdp.attach(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const close = async () => {
    await fetch(`http://127.0.0.1:${args.cdp}/json/close/${tab.id}`).catch(() => {});
    cdp.close();
  };

  try {
    await waitFor(
      cdp,
      '!!(window.__scv && window.__scv.getState().scenario'
        + ' && document.getElementById("concept-title").textContent !== "loading...")',
      'candidate shell boot',
    );

    const conceptId = await cdp.eval('window.__scv.getState().concept.concept_id');
    const buildId = await cdp.eval('document.getElementById("build-id").textContent');
    const loadedItems = await cdp.eval('window.__scv.getState().scenario.items.length');
    if (conceptId !== CONCEPT_ID) failures.push(`served ${conceptId}, expected ${CONCEPT_ID}`);
    if (loadedItems !== 3) failures.push(`browser loaded ${loadedItems} authored items, expected 3`);
    process.stdout.write(`concept_id : ${conceptId}\nbuild_id   : ${buildId}\nitems      : ${loadedItems}\n`);

    const capture = async (name) => {
      if (!args.captureDir) return;
      const path = join(args.captureDir, `${name}.png`);
      await cdp.screenshot(path);
      captures.push(path);
      process.stdout.write(`  capture ${name}.png\n`);
    };

    const press = async (label, code, expectEvent = true) => {
      const before = JSON.parse(await cdp.eval(STATE));
      await cdp.key(code);
      let after = before;
      if (expectEvent) {
        const raw = await waitFor(
          cdp,
          `(function(){const s=window.__scv.getState();return s.events.length>${before.events}?${STATE}:null})()`,
          label,
          5_000,
        );
        after = JSON.parse(raw);
      }
      timeline.push({ label, code, ...after });
      process.stdout.write(`  ${label.padEnd(40)} ${after.status}\n`);
      return after;
    };

    await capture('01-launch-three-items');
    if (args.staleProfile) {
      await cdp.eval(
        'localStorage.setItem("scv.profile.panic_at_the_pawnshop",'
          + 'JSON.stringify({version:0,concept_id:"panic_at_the_pawnshop",sessions_started:99}))',
      );
      await cdp.send('Page.reload');
      await waitFor(
        cdp,
        '!!(window.__scv && window.__scv.getState().scenario'
          + ' && document.getElementById("concept-title").textContent !== "loading...")',
        'shell reload with stale profile',
      );
    }
    await press('Enter start shift', 'Enter');

    if (args.invalidFirst) {
      const blocked = await press('Space appraise without evidence', 'Space');
      if (!/blocked appraise_watch: missing watch_uv, watch_serial/i.test(blocked.status)) {
        failures.push(`unsupported appraisal did not name both missing findings: ${blocked.status}`);
      }
      if (blocked.finished) failures.push('invalid-first appraisal completed the scenario');
      await capture('02-invalid-appraisal-blocked');
    }

    for (const stepId of descriptor.replay) {
      const step = descriptor.steps.find((candidate) => candidate.id === stepId);
      const state = await press(`${step.kind} ${step.id}`, KEY_FOR_KIND[step.kind]);
      if (!state.completed.includes(step.id)) failures.push(`${step.id} did not complete on the real surface`);

      if (step.kind === 'inspect' && step.tool) {
        evidence.push({
          item: step.item,
          step_id: step.id,
          tool: step.tool,
          evidence_kind: step.evidence_kind,
          supports: step.supports,
          finding: step.finding,
        });
        if (step.id.endsWith('serial') || step.id.endsWith('provenance') || step.id.endsWith('registry')) {
          await capture(`evidence-${step.item}`);
        }
      }
      if (step.kind === 'core_action') {
        const item = descriptor.items.find((candidate) => candidate.item_id === step.item);
        outcomes.push({
          item: item.item_id,
          truth: item.truth,
          appraisal: item.correct_appraisal,
          disposition: item.correct_disposition,
          offer: item.offer,
          consequence: item.consequence,
          evidence: step.requires,
        });
        await capture(`outcome-${item.item_id}`);
      }
      if (step.kind === 'reveal') await capture('09-manufactured-scarcity-reveal');
    }

    const done = await press('Enter complete shift', 'Enter');
    if (!done.finished) failures.push('valid replay did not finish');
    await capture('10-disposition-and-next-shift-hook');

    const events = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.getState().events)'));
    const validation = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.validate())'));
    const names = events.map((event) => event.event);
    const required = [
      'session_started',
      'core_action_completed',
      'signature_reveal_seen',
      'choice_committed',
      'scenario_completed',
      'session_ended',
    ];
    for (const event of required) if (!names.includes(event)) failures.push(`missing ${event}`);
    if (!validation.ok) failures.push(`telemetry invalid: ${validation.errors.join('; ')}`);
    if (names.filter((name) => name === 'core_action_completed').length !== 3) {
      failures.push('real replay did not commit exactly three appraisal core actions');
    }
    if (evidence.length !== 6) failures.push(`recorded ${evidence.length} evidence findings, expected 6`);
    for (const item of descriptor.items) {
      const itemEvidence = evidence.filter((entry) => entry.item === item.item_id);
      if (new Set(itemEvidence.map((entry) => entry.tool)).size < 2) {
        failures.push(`${item.item_id} lacks two browser-recorded evidence tools`);
      }
      if (!itemEvidence.some((entry) => entry.tool === 'uv_lamp')) {
        failures.push(`${item.item_id} lacks browser-recorded UV evidence`);
      }
    }
    if (outcomes.length !== 3) failures.push(`recorded ${outcomes.length} outcomes, expected 3`);
    if (!outcomes.some((outcome) => outcome.truth === 'forged')) failures.push('fake outcome absent');
    if (!outcomes.some((outcome) => outcome.truth === 'authentic')) failures.push('legitimate outcome absent');
    if (!names.includes('next_hook_shown')) failures.push('next-shift hook absent');
    if (args.invalidFirst && names.filter((name) => name === 'invalid_action_blocked').length < 1) {
      failures.push('invalid-first run emitted no invalid_action_blocked event');
    }
    if (args.staleProfile) {
      const recovered = events.find((event) => event.event === 'profile_recovered');
      if (recovered?.payload?.reason !== 'version_mismatch') {
        failures.push(`stale profile was not surfaced as version_mismatch: ${JSON.stringify(recovered)}`);
      }
    }

    const artifact = {
      concept_id: CONCEPT_ID,
      build_id: buildId,
      invalid_first: args.invalidFirst,
      stale_profile: args.staleProfile,
      authored_item_count: descriptor.items.length,
      evidence,
      outcomes,
      reveal: descriptor.steps.find((step) => step.kind === 'reveal').finding,
      next_shift_hook: descriptor.next_shift_hook,
      events,
      validation,
      timeline,
      captures,
      failures,
    };
    if (args.captureDir) {
      writeFileSync(join(args.captureDir, 'browser-session.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    }

    process.stdout.write(`\nevidence findings : ${evidence.length} (2 per item, UV on each)\n`);
    process.stdout.write(`appraisal outcomes: ${outcomes.length}\n`);
    process.stdout.write(`schema validation : ${validation.ok ? 'VALID' : 'INVALID'}\n`);
    process.stdout.write(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'}\n`);
    failures.forEach((failure) => process.stdout.write(`  FAIL ${failure}\n`));
    await close();
    process.exit(failures.length === 0 ? 0 : 1);
  } catch (error) {
    await close();
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`browser-qa failed: ${error.message}\n`);
  process.exit(1);
});
