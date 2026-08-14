#!/usr/bin/env node
/**
 * Real-surface interactive browser QA.
 *
 * Drives the ACTUAL browser shell in a real Chrome instance over the Chrome
 * DevTools Protocol, dispatching genuine key events and reading back the
 * telemetry the page itself produced. This exercises the same code path a human
 * owner uses - it does not re-run the headless scenario engine.
 *
 * Uses Node 22's built-in WebSocket: no dependencies, no installs.
 *
 * Usage:
 *   node tools/browser-qa.js --concept <id> [--port 8177] [--cdp 9222] [--invalid-first]
 *
 * Exit: 0 pass, 1 fail, 2 bad invocation.
 */

function parseArgs(argv) {
  const args = { concept: null, port: 8177, cdp: 9222, invalidFirst: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--concept') args.concept = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--cdp') args.cdp = Number(argv[++i]);
    else if (a === '--invalid-first') args.invalidFirst = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over the built-in WebSocket. */
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
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
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

  close() {
    this.ws.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.concept) {
    process.stderr.write('browser-qa: --concept is required\n');
    process.exit(2);
  }

  const pageUrl = `http://127.0.0.1:${args.port}/`;
  const tabRes = await fetch(`http://127.0.0.1:${args.cdp}/json/new?${encodeURIComponent(pageUrl)}`, {
    method: 'PUT',
  });
  const tab = await tabRes.json();
  const cdp = await Cdp.attach(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  // Wait for the shell to boot (bootstrap fetch + first render).
  let booted = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      const ready = await cdp.eval(
        '!!(window.__scv && document.getElementById("concept-title") && document.getElementById("concept-title").textContent !== "loading...")',
      );
      if (ready) { booted = true; break; }
    } catch { /* page still navigating */ }
    await sleep(100);
  }
  if (!booted) throw new Error('shell did not boot within 6s');

  await cdp.eval('window.focus()');

  const title = await cdp.eval('document.getElementById("concept-title").textContent');
  const conceptId = await cdp.eval('window.__scv.getState().concept.concept_id');
  const buildId = await cdp.eval('document.getElementById("build-id").textContent');
  process.stdout.write(`page title : ${title}\nconcept_id : ${conceptId}\nbuild_id   : ${buildId}\n\n`);

  if (conceptId !== args.concept) {
    throw new Error(`page served the wrong concept: expected ${args.concept}, got ${conceptId}`);
  }

  const step = async (label, code) => {
    await cdp.key(code);
    await sleep(70);
    const raw = await cdp.eval(
      'JSON.stringify({status:document.getElementById("status").textContent,events:window.__scv.getState().events.length,beats:window.__scv.getState().beats.length})',
    );
    const s = JSON.parse(raw);
    process.stdout.write(
      `  ${label.padEnd(36)} events=${String(s.events).padStart(2)} beats=${s.beats} | ${s.status}\n`,
    );
    return s;
  };

  if (args.invalidFirst) {
    process.stdout.write('-- invalid-path probe: actions attempted out of order --\n');
    await step('Space before session start', 'Space');
    await step('Enter start session', 'Enter');
    await step('Q reveal before 3x core action', 'KeyQ');
    await step('F choice before reveal', 'KeyF');
    await step('Enter complete before choice', 'Enter');
    process.stdout.write('\n-- recovery: valid path after invalid attempts --\n');
  } else {
    process.stdout.write('-- happy path --\n');
    await step('Enter start session', 'Enter');
  }

  for (let i = 1; i <= 3; i += 1) await step(`Space core action ${i}/3`, 'Space');
  await step('Q signature reveal', 'KeyQ');
  await step('F commit choice', 'KeyF');
  await step('Enter complete scenario', 'Enter');

  const events = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.getState().events)'));
  const validation = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.validate())'));
  const names = events.map((e) => e.event);

  process.stdout.write(`\nevent stream (${events.length}):\n  ${names.join('\n  -> ')}\n`);

  const REQUIRED = [
    'session_started',
    'core_action_completed',
    'signature_reveal_seen',
    'choice_committed',
    'scenario_completed',
    'session_ended',
  ];
  const missing = REQUIRED.filter((r) => !names.includes(r));
  const blocked = events.filter((e) => e.event === 'invalid_action_blocked');
  const uniqueBuildIds = new Set(events.map((e) => e.build_id));

  process.stdout.write(`\nschema validation      : ${validation.ok ? 'VALID' : 'INVALID: ' + validation.errors.join('; ')}\n`);
  process.stdout.write(`required events        : ${missing.length === 0 ? 'ALL 6 PRESENT' : 'MISSING ' + missing.join(', ')}\n`);
  process.stdout.write(`core actions performed : ${names.filter((n) => n === 'core_action_completed').length}\n`);
  process.stdout.write(`build_id in telemetry  : ${[...uniqueBuildIds].join(', ')}\n`);
  process.stdout.write(`invalid actions blocked: ${blocked.length}\n`);
  for (const b of blocked) {
    process.stdout.write(`   blocked ${b.payload.attempted} (${b.payload.reason})\n`);
  }

  const expectBlocked = args.invalidFirst ? blocked.length >= 3 : true;
  const ok = validation.ok && missing.length === 0 && uniqueBuildIds.size === 1 && expectBlocked;
  process.stdout.write(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}\n`);

  await fetch(`http://127.0.0.1:${args.cdp}/json/close/${tab.id}`).catch(() => {});
  cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`browser-qa failed: ${err.message}\n`);
  process.exit(1);
});
