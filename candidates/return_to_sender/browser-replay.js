#!/usr/bin/env node
/** Real-Chrome/CDP replay for RETURN TO SENDER. Candidate-owned. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONCEPT_ID = 'return_to_sender';

function parseArgs(argv) {
  const args = { port: 8177, cdp: 9222, invalidFirst: false, shots: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--cdp') args.cdp = Number(argv[++i]);
    else if (argv[i] === '--invalid-first') args.invalidFirst = true;
    else if (argv[i] === '--shots') args.shots = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

class Cdp {
  static async attach(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true });
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
      const timeout = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      timeout.unref?.();
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async key(code) {
    const keys = { Enter: 'Enter', KeyE: 'e', Space: ' ', KeyQ: 'q', KeyF: 'f', Digit1: '1' };
    const virtual = { Enter: 13, KeyE: 69, Space: 32, KeyQ: 81, KeyF: 70, Digit1: 49 };
    const common = { code, key: keys[code], windowsVirtualKeyCode: virtual[code] };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  async screenshot(path) {
    const capture = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(capture.data, 'base64'));
  }

  close() { this.ws.close(); }
}

async function waitFor(cdp, expression, label) {
  for (let i = 0; i < 100; i += 1) {
    try {
      if (await cdp.eval(expression)) return;
    } catch { /* navigation in progress */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.shots) mkdirSync(args.shots, { recursive: true });

  const pageUrl = `http://127.0.0.1:${args.port}/`;
  const tabResponse = await fetch(`http://127.0.0.1:${args.cdp}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
  if (!tabResponse.ok) throw new Error(`cannot create Chrome tab: HTTP ${tabResponse.status}`);
  const tab = await tabResponse.json();
  const cdp = await Cdp.attach(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  try {
    await waitFor(
      cdp,
      '!!(window.__scv && window.__scv.getState().scenario && document.getElementById("concept-title").textContent !== "loading...")',
      'candidate shell boot',
    );
    await cdp.eval('window.focus()');

    const concept = await cdp.eval('window.__scv.getState().concept.concept_id');
    const buildId = await cdp.eval('document.getElementById("build-id").textContent');
    if (concept !== CONCEPT_ID) throw new Error(`wrong concept served: ${concept}`);
    process.stdout.write(`concept_id : ${concept}\nbuild_id   : ${buildId}\n\n`);

    const press = async (label, code) => {
      const before = await cdp.eval('window.__scv.getState().events.length');
      await cdp.key(code);
      await waitFor(cdp, `window.__scv.getState().events.length > ${before} || document.getElementById("status").textContent.length > 0`, label);
      const state = JSON.parse(await cdp.eval(`JSON.stringify({
        status: document.getElementById('status').textContent,
        events: window.__scv.getState().events.length,
        completed: window.__scv.getState().completedSteps,
        finished: window.__scv.getState().finished
      })`));
      process.stdout.write(`${label.padEnd(43)} events=${String(state.events).padStart(2)} | ${state.status}\n`);
      return state;
    };
    const shot = async (name) => {
      if (!args.shots) return;
      await cdp.eval(`document.getElementById('status').scrollIntoView({block:'center'})`);
      await cdp.screenshot(join(args.shots, `${name}.png`));
      process.stdout.write(`[capture] ${name}.png\n`);
    };

    await press('Enter start session', 'Enter');
    await press('E scan obstruction', 'KeyE');

    if (args.invalidFirst) {
      await press('1 compactor before fragile/priority', 'Digit1');
      await shot('00-compactor-fragile-priority-blocked');
    }

    await press('Space sort normal', 'Space');
    await press('Space divert fragile', 'Space');
    await press('Space stage returns', 'Space');

    if (args.invalidFirst) {
      await press('Enter exit before priority queue', 'Enter');
      await shot('01-exit-blocked');
      await press('Space compactor before priority', 'Space');
      await shot('02-compactor-blocked');
    }

    await press('E commit priority order', 'KeyE');
    await press('Space route packaging compactor', 'Space');
    await press('Space restore lane access', 'Space');
    await shot('03-lane-restored');
    await press('Q reveal subscription loop', 'KeyQ');
    await press('F commit return disposition', 'KeyF');
    await press('Enter complete scenario', 'Enter');
    await shot('04-completed');

    const state = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.getState())'));
    const validation = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.validate())'));
    const events = state.events;
    const names = events.map((event) => event.event);
    const blocked = events.filter((event) => event.event === 'invalid_action_blocked');
    const compactorBlock = blocked.find((event) => event.payload.attempted === 'route_compactor');
    const exitBlock = blocked.find((event) => event.payload.attempted === 'scenario_completed');
    const completionIndex = names.indexOf('scenario_completed');
    const blockIndices = blocked.map((event) => events.indexOf(event));
    const checks = {
      schema_valid: validation.ok,
      scenario_finished: state.finished,
      all_steps_completed: state.completedSteps.length === state.scenario.steps.length,
      five_core_actions: names.filter((name) => name === 'core_action_completed').length === 5,
      reveal_present: names.includes('signature_reveal_seen'),
      disposition_present: names.includes('choice_committed'),
      next_hook_present: names.includes('next_hook_shown'),
      one_build_id: new Set(events.map((event) => event.build_id)).size === 1,
      invalid_first_named_and_recovered: !args.invalidFirst || (
        compactorBlock?.payload.reason === 'prerequisites_not_met'
        && compactorBlock.payload.missing.includes('sort_fragile_divert')
        && compactorBlock.payload.missing.includes('priority_order_committed')
        && exitBlock?.payload.reason === 'beats_incomplete'
        && blockIndices.every((index) => index < completionIndex)
      ),
    };
    const ok = Object.values(checks).every(Boolean);
    const report = { concept_id: concept, build_id: buildId, checks, blocked: blocked.map((event) => event.payload), validation, events };
    if (args.shots) writeFileSync(join(args.shots, 'browser-session.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\n${JSON.stringify({ checks, blocked: report.blocked }, null, 2)}\nRESULT: ${ok ? 'PASS' : 'FAIL'}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await fetch(`http://127.0.0.1:${args.cdp}/json/close/${tab.id}`).catch(() => {});
    cdp.close();
  }
}

main().catch((error) => {
  process.stderr.write(`browser replay failed: ${error.message}\n`);
  process.exit(1);
});
