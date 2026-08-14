#!/usr/bin/env node
/** Real Chrome/CDP invalid-first and valid replay for Task 4. */

function args(argv) {
  const out = { port: 8177, cdp: 9222, evidence: null, staleFirst: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--cdp') out.cdp = Number(argv[++i]);
    else if (argv[i] === '--evidence') out.evidence = argv[++i];
    else if (argv[i] === '--stale-first') out.staleFirst = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!out.evidence) throw new Error('--evidence is required');
  return out;
}

class Cdp {
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      timer.unref?.();
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async key(code) {
    const key = { Enter: 'Enter', KeyE: 'e', Space: ' ', KeyQ: 'q', KeyF: 'f' }[code];
    const vk = { Enter: 13, KeyE: 69, Space: 32, KeyQ: 81, KeyF: 70 }[code];
    const common = { code, key, windowsVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  close() { this.ws.close(); }
}

async function screenshot(cdp, path) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, Buffer.from(shot.data, 'base64'));
}

async function snapshot(cdp) {
  return JSON.parse(await cdp.eval(`JSON.stringify({
    status: document.getElementById('status').textContent,
    completed: window.__scv.getState().completedSteps,
    beats: window.__scv.getState().beats,
    events: window.__scv.getState().events,
    validation: window.__scv.validate()
  })`));
}

async function main() {
  const config = args(process.argv);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(config.evidence, { recursive: true });
  const tab = await (await fetch(`http://127.0.0.1:${config.cdp}/json/new?${encodeURIComponent(`http://127.0.0.1:${config.port}/`)}`, { method: 'PUT' })).json();
  const cdp = await Cdp.open(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 80; i += 1) {
    if (await cdp.eval(`!!window.__scv`).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (config.staleFirst) {
    await cdp.eval(`localStorage.setItem('scv.profile.theme_park_liquidation', JSON.stringify({version:0,concept_id:'theme_park_liquidation',sessions_started:99,sessions_completed:99})); location.reload()`);
    for (let i = 0; i < 80; i += 1) {
      if (await cdp.eval(`!!window.__scv`).catch(() => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const log = [];
  const press = async (label, code) => {
    await cdp.key(code);
    const state = await snapshot(cdp);
    log.push(`${label}: events=${state.events.length}; completed=${state.completed.length}; status=${state.status}`);
    return state;
  };

  await screenshot(cdp, `${config.evidence}/01-before.png`);
  await press('start', 'Enter');
  await press('open shop', 'KeyE');
  await press('triage plush', 'Space');
  await press('triage collectibles', 'Space');
  await press('clear rack', 'Space');
  await press('attempt reveal before debris/control repair', 'KeyQ');
  await press('attempt completion with path/control missing', 'Enter');
  const invalid = await snapshot(cdp);
  await screenshot(cdp, `${config.evidence}/02-invalid-blocked.png`);

  const invalidEvents = invalid.events.map((event) => event.event);
  const invalidBlocked = invalid.events.filter((event) => event.event === 'invalid_action_blocked');
  if (config.staleFirst && !invalid.events.some((event) => event.event === 'profile_recovered' && event.payload.reason === 'version_mismatch')) {
    throw new Error('stale profile was not recovered by name');
  }
  if (invalidEvents.includes('scenario_completed')) throw new Error('invalid-first emitted scenario_completed');
  if (!invalidBlocked.some((event) => event.payload.missing?.includes('reseat_fuse'))) {
    throw new Error('invalid-first did not name missing repair prerequisite reseat_fuse');
  }

  await press('clear debris', 'Space');
  await press('recover belt and fuse', 'Space');
  await press('refit drive belt', 'Space');
  await press('reseat fuse', 'Space');
  await press('reveal manifest', 'KeyQ');
  const reveal = await snapshot(cdp);
  await screenshot(cdp, `${config.evidence}/03-manifest-reveal.png`);
  await press('commit display disposition', 'KeyF');
  await press('start scripted mascot show', 'Space');
  await press('show next-attraction hook step', 'KeyE');
  await press('complete scenario', 'Enter');
  const end = await snapshot(cdp);
  await screenshot(cdp, `${config.evidence}/04-completed.png`);

  const names = end.events.map((event) => event.event);
  const required = ['session_started', 'core_action_completed', 'signature_reveal_seen', 'choice_committed', 'scenario_completed', 'next_hook_shown', 'session_ended'];
  const missing = required.filter((event) => !names.includes(event));
  const showIndex = end.events.findIndex((event) => event.payload?.step_id === 'run_show');
  const repairIndex = end.events.findIndex((event) => event.payload?.step_id === 'reseat_fuse');
  const pathIndex = end.events.findIndex((event) => event.payload?.step_id === 'clear_debris');
  if (!end.validation.ok || missing.length) throw new Error(`invalid telemetry or missing events: ${missing.join(',')}`);
  if (!(showIndex > repairIndex && showIndex > pathIndex)) throw new Error('show occurred before path/control repair');
  if (!reveal.events.some((event) => event.event === 'signature_reveal_seen')) throw new Error('manifest reveal absent');

  const result = {
    result: 'PASS',
    concept_id: await cdp.eval(`window.__scv.getState().concept.concept_id`),
    stale_profile_recovered: config.staleFirst
      ? invalid.events.some((event) => event.event === 'profile_recovered' && event.payload.reason === 'version_mismatch')
      : null,
    invalid_first: {
      scenario_completed: false,
      blocked: invalidBlocked.map((event) => event.payload),
    },
    valid_replay: {
      completed_steps: end.completed,
      event_names: names,
      telemetry_valid: end.validation.ok,
      path_index: pathIndex,
      repair_index: repairIndex,
      show_index: showIndex,
      final_status: end.status,
    },
    log,
  };
  await writeFile(`${config.evidence}/browser-qa.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${log.join('\n')}\nRESULT: PASS\n`);
  await fetch(`http://127.0.0.1:${config.cdp}/json/close/${tab.id}`).catch(() => {});
  cdp.close();
}

main().catch((error) => { process.stderr.write(`browser-qa failed: ${error.message}\n`); process.exit(1); });
