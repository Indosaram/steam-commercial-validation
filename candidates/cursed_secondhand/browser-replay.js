#!/usr/bin/env node
/**
 * CURSED SECONDHAND real-browser replay driver (Task 5, candidate-owned).
 *
 * Drives the ACTUAL served shell in a real Chrome over the Chrome DevTools
 * Protocol with genuine key events, then reads back the telemetry the page
 * itself produced. It does not re-run the headless engine.
 *
 * The shared tools/browser-qa.js drives the BLANK-shell beat order (Space x3,
 * Q, F, Enter). This candidate ships a 7-step descriptor with two inspect
 * steps, so it needs its own key sequence. That is exactly why this driver
 * lives in the candidate's own directory instead of patching shared tools/.
 *
 * Shell verb mapping for a descriptor-driven candidate (shell/shell.js):
 *   Enter -> advance/start   E -> next pending `inspect` step
 *   Space -> next pending `core_action`   Q -> `reveal`   F -> `choice`
 *
 * Usage:
 *   node candidates/cursed_secondhand/browser-replay.js \
 *     [--port 8177] [--cdp 9222] [--invalid-first] [--shots <dir>]
 *
 * Exit: 0 pass, 1 fail, 2 bad invocation.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONCEPT = 'cursed_secondhand';

function parseArgs(argv) {
  const args = { port: 8177, cdp: 9222, invalidFirst: false, shots: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--cdp') args.cdp = Number(argv[++i]);
    else if (a === '--invalid-first') args.invalidFirst = true;
    else if (a === '--shots') args.shots = argv[++i];
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

/** Minimal CDP client over Node's built-in WebSocket. No dependencies. */
class Cdp {
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect: ${wsUrl}`)), { once: true });
    });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      const t = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      t.unref?.();
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`page exception: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value;
  }

  async key(code) {
    const KEY = { Space: ' ', Enter: 'Enter', KeyQ: 'q', KeyF: 'f', KeyE: 'e', KeyR: 'r' };
    const VK = { Space: 32, Enter: 13, KeyQ: 81, KeyF: 70, KeyE: 69, KeyR: 82 };
    const common = { code, key: KEY[code] ?? code, windowsVirtualKeyCode: VK[code] ?? 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }

  close() { this.ws.close(); }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.shots) mkdirSync(args.shots, { recursive: true });

  const pageUrl = `http://127.0.0.1:${args.port}/`;
  const tabRes = await fetch(`http://127.0.0.1:${args.cdp}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
  const tab = await tabRes.json();
  const cdp = await Cdp.attach(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // Wait for the shell's own readiness signal - poll on state, never a fixed sleep.
  let booted = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      const ready = await cdp.eval(
        '!!(window.__scv && window.__scv.getState().scenario && document.getElementById("concept-title").textContent !== "loading...")',
      );
      if (ready) { booted = true; break; }
    } catch { /* still navigating */ }
    await new Promise((r) => { const t = setTimeout(r, 50); t.unref?.(); });
  }
  if (!booted) throw new Error('shell did not boot');

  await cdp.eval('window.focus()');

  const conceptId = await cdp.eval('window.__scv.getState().concept.concept_id');
  const buildId = await cdp.eval('document.getElementById("build-id").textContent');
  const stepIds = await cdp.eval('JSON.stringify(window.__scv.getState().scenario.steps.map(s=>s.id))');
  process.stdout.write(`concept_id : ${conceptId}\nbuild_id   : ${buildId}\nsteps      : ${stepIds}\n\n`);
  if (conceptId !== CONCEPT) throw new Error(`wrong concept served: ${conceptId}`);

  /** Dispatch one key and read back the page's own resulting state. */
  const step = async (label, code) => {
    await cdp.key(code);
    // Settle on the page's rendered state rather than guessing a delay.
    let s = null;
    for (let i = 0; i < 40; i += 1) {
      s = JSON.parse(await cdp.eval(
        'JSON.stringify({status:document.getElementById("status").textContent,'
        + 'events:window.__scv.getState().events.length,'
        + 'done:window.__scv.getState().completedSteps})',
      ));
      if (s.status) break;
      await new Promise((r) => { const t = setTimeout(r, 25); t.unref?.(); });
    }
    process.stdout.write(`  ${label.padEnd(42)} events=${String(s.events).padStart(2)} | ${s.status}\n`);
    return s;
  };

  const shot = async (name) => {
    if (!args.shots) return;
    await cdp.shot(join(args.shots, `${name}.png`));
    process.stdout.write(`  [capture] ${name}.png\n`);
  };

  const denials = [];

  if (args.invalidFirst) {
    process.stdout.write('-- INVALID PATH: skip the diagnostic and the tools, attempt the reveal --\n');
    await step('Enter start session', 'Enter');
    await shot('01-before-intake');
    // Reveal with nothing diagnosed: must be denied by name.
    denials.push(await step('Q interior reveal (no diagnosis)', 'KeyQ'));
    // Choice before the reveal: must be denied by name.
    denials.push(await step('F disposition (no reveal)', 'KeyF'));
    // Third restoration pass before the earlier passes: must be denied.
    denials.push(await step('Space restoration pass (no diagnosis)', 'Space'));
    denials.push(await step('Enter complete (nothing done)', 'Enter'));
    await shot('02-invalid-denied');
    process.stdout.write('\n-- RECOVERY: the same session continues on the valid path --\n');
  } else {
    process.stdout.write('-- HAPPY PATH --\n');
    await step('Enter start session', 'Enter');
    await shot('01-before-intake');
  }

  await step('E diagnose traces', 'KeyE');
  await shot('03-diagnosed');
  await step('Space restoration 1/3 dust', 'Space');
  await step('Space restoration 2/3 solder', 'Space');
  await step('Space restoration 3/3 trace', 'Space');
  await shot('04-restored');
  await step('E read memory clue', 'KeyE');
  await step('Q interior reveal', 'KeyQ');
  await shot('05-reveal');
  await step('F commit disposition', 'KeyF');
  await step('Enter complete scenario', 'Enter');
  await shot('06-end-state');

  const events = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.getState().events)'));
  const validation = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.validate())'));
  const names = events.map((e) => e.event);

  process.stdout.write(`\nevent stream (${events.length}):\n  ${names.join('\n  -> ')}\n`);

  const REQUIRED = [
    'session_started', 'core_action_completed', 'signature_reveal_seen',
    'choice_committed', 'scenario_completed', 'session_ended',
  ];
  const missing = REQUIRED.filter((r) => !names.includes(r));
  const blocked = events.filter((e) => e.event === 'invalid_action_blocked');
  const coreActions = names.filter((n) => n === 'core_action_completed').length;
  const inspects = names.filter((n) => n === 'inspect_performed').length;
  const buildIds = new Set(events.map((e) => e.build_id));

  process.stdout.write(`\nschema validation      : ${validation.ok ? 'VALID' : 'INVALID: ' + validation.errors.join('; ')}\n`);
  process.stdout.write(`required events        : ${missing.length === 0 ? 'ALL 6 PRESENT' : 'MISSING ' + missing.join(', ')}\n`);
  process.stdout.write(`restoration passes     : ${coreActions}\n`);
  process.stdout.write(`inspect steps          : ${inspects} (diagnosis + memory clue)\n`);
  process.stdout.write(`build_id in telemetry  : ${[...buildIds].join(', ')}\n`);
  process.stdout.write(`invalid actions blocked: ${blocked.length}\n`);
  for (const b of blocked) {
    const miss = b.payload.missing ? ` missing=${b.payload.missing.join(',')}` : '';
    process.stdout.write(`   denied ${b.payload.attempted} (${b.payload.reason})${miss}\n`);
  }

  // A denial must NAME what is missing: an unnamed denial is a soft-lock.
  const namedDenials = blocked.filter(
    (b) => b.payload.reason && (b.payload.missing?.length > 0 || b.payload.reason !== 'prerequisites_not_met'),
  );
  const exactBlock = (attempted, expectedMissing, reason = 'prerequisites_not_met') => blocked.some(
    (event) => event.payload.attempted === attempted
      && event.payload.reason === reason
      && JSON.stringify(event.payload.missing ?? []) === JSON.stringify(expectedMissing),
  );
  const invalidFirstExact = !args.invalidFirst || (
    exactBlock('interior_reveal', ['memory_clue'])
    && exactBlock('disposition', ['interior_reveal'])
    && exactBlock('dust_pass', ['diagnose'])
    && blocked.some(
      (event) => event.payload.attempted === 'scenario_completed'
        && event.payload.reason === 'beats_incomplete',
    )
    && events.findIndex((event) => event.event === 'scenario_completed')
      > events.map((event) => event.event).lastIndexOf('invalid_action_blocked')
  );

  const ok = validation.ok
    && missing.length === 0
    && coreActions === 3
    && inspects === 2
    && buildIds.size === 1
    && invalidFirstExact
    && (!args.invalidFirst || (blocked.length >= 4 && namedDenials.length === blocked.length));

  process.stdout.write(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}\n`);

  if (args.shots) {
    writeFileSync(join(args.shots, 'session.json'), `${JSON.stringify({ events, validation }, null, 2)}\n`);
  }

  await fetch(`http://127.0.0.1:${args.cdp}/json/close/${tab.id}`).catch(() => {});
  cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`browser-replay failed: ${err.message}\n`);
  process.exit(1);
});
