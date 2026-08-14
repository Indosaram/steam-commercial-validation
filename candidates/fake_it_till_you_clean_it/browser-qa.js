#!/usr/bin/env node
/**
 * Candidate-specific real-browser QA for FAKE IT TILL YOU CLEAN IT.
 *
 * The shared tools/browser-qa.js drives the BLANK shell's fixed key sequence
 * (3x Space, Q, F, Enter). This candidate declares seven ordered steps with a
 * different kind ordering, so it needs its own driver. This one derives the
 * key sequence from the descriptor itself rather than hardcoding it.
 *
 * It drives a real Chrome over CDP, dispatching genuine key events into the
 * real shell, and captures the visible state at every required beat.
 *
 * Usage:
 *   node candidates/fake_it_till_you_clean_it/browser-qa.js \
 *     --port 8177 --cdp 9222 [--invalid-first] [--capture-dir DIR]
 *
 * Exit: 0 pass, 1 fail, 2 bad invocation.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import descriptor from './scenario.js';

const CONCEPT_ID = 'fake_it_till_you_clean_it';

/** Shared input map: which key drives which step kind (core/input.js). */
const KEY_FOR_KIND = Object.freeze({
  inspect: 'KeyE',      // interact verb -> runCandidateStep('inspect')
  core_action: 'Space', // core_action verb
  reveal: 'KeyQ',       // inspect verb -> runCandidateStep('reveal')
  choice: 'KeyF',       // commit_choice verb
});

function parseArgs(argv) {
  const args = { port: 8177, cdp: 9222, invalidFirst: false, captureDir: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--cdp') args.cdp = Number(argv[++i]);
    else if (a === '--invalid-first') args.invalidFirst = true;
    else if (a === '--capture-dir') args.captureDir = argv[++i];
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

  async screenshot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }

  close() { this.ws.close(); }
}

/**
 * Await a page-observable condition instead of sleeping.
 * Polls the page's own state via CDP with a bounded timeout; there is no
 * fixed delay that could make a pass depend on timing luck.
 */
async function waitFor(cdp, expression, what, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await cdp.eval(expression);
      if (last) return last;
    } catch { /* page mid-navigation */ }
  }
  throw new Error(`timed out waiting for ${what} (last=${JSON.stringify(last)})`);
}

const stateExpr = 'JSON.stringify({'
  + 'status:document.getElementById("status").textContent,'
  + 'events:window.__scv.getState().events.length,'
  + 'completed:window.__scv.getState().completedSteps,'
  + 'finished:window.__scv.getState().finished})';

async function main() {
  const args = parseArgs(process.argv);
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535
    || !Number.isInteger(args.cdp) || args.cdp < 1 || args.cdp > 65535) {
    process.stderr.write('browser-qa: --port and --cdp must be integer ports in 1-65535\n');
    process.exit(2);
  }
  if (args.captureDir) mkdirSync(args.captureDir, { recursive: true });

  const failures = [];
  const captures = [];
  const timeline = [];

  const pageUrl = `http://127.0.0.1:${args.port}/`;
  const tabRes = await fetch(`http://127.0.0.1:${args.cdp}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
  const tab = await tabRes.json();
  const cdp = await Cdp.attach(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  try {
    // Boot: wait on the page's own readiness, no fixed sleep.
    const awaitBoot = () => waitFor(
      cdp,
      '!!(window.__scv && window.__scv.getState().scenario'
      + ' && document.getElementById("concept-title")'
      + ' && document.getElementById("concept-title").textContent !== "loading...")',
      'shell boot',
    );
    await awaitBoot();

    const conceptId = await cdp.eval('window.__scv.getState().concept.concept_id');
    const buildId = await cdp.eval('document.getElementById("build-id").textContent');
    const servedScenario = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.getState().scenario)'));
    const stepCount = servedScenario.steps.length;
    process.stdout.write(`concept_id : ${conceptId}\nbuild_id   : ${buildId}\nsteps      : ${stepCount}\n\n`);

    if (conceptId !== CONCEPT_ID) failures.push(`page served ${conceptId}, expected ${CONCEPT_ID}`);
    if (stepCount !== descriptor.steps.length) {
      failures.push(`page shows ${stepCount} steps, descriptor declares ${descriptor.steps.length}`);
    }
    if (servedScenario.set?.id !== 'gold_pool_courtyard') failures.push('served scenario is not the one gold pool/courtyard set');
    if (servedScenario.visible_proof?.before !== descriptor.visible_proof.before
      || servedScenario.visible_proof?.after !== descriptor.visible_proof.after) {
      failures.push('served scenario lost the declared gold-to-decay visible proof');
    }
    const disposition = servedScenario.steps.find((step) => step.id === 'disposition');
    const optionIds = disposition?.options?.map((option) => option.id) ?? [];
    if (JSON.stringify(optionIds) !== JSON.stringify(['preserve', 'discard', 'archive'])) {
      failures.push(`served disposition options are ${optionIds.join(', ') || 'missing'}`);
    }
    if (disposition?.default_option !== 'archive') failures.push('served disposition does not commit the declared archive option');

    // Browser profile adversary: stale data must recover by name, then R must
    // clear it. Reloading creates a fresh shell session while retaining the
    // same real browser/profile boundary.
    const profileKey = `scv.profile.${CONCEPT_ID}`;
    await cdp.eval(`localStorage.setItem(${JSON.stringify(profileKey)}, JSON.stringify({version:0,concept_id:${JSON.stringify(CONCEPT_ID)},sessions_started:41,sessions_completed:9}))`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await awaitBoot();
    await cdp.key('Enter');
    await waitFor(
      cdp,
      'window.__scv.getState().events.some(function(e){return e.event==="profile_recovered"})',
      'stale profile recovery event',
    );
    const recoveryReason = await cdp.eval(
      'window.__scv.getState().events.find(function(e){return e.event==="profile_recovered"}).payload.reason',
    );
    const recoveryStatus = await cdp.eval('document.getElementById("status").textContent');
    if (recoveryReason !== 'version_mismatch' || !/version_mismatch/.test(recoveryStatus)) {
      failures.push(`stale profile recovery was not surfaced by name (${recoveryReason}: ${recoveryStatus})`);
    }
    await cdp.key('KeyR');
    const resetStatus = await cdp.eval('document.getElementById("status").textContent');
    if (!/Profile reset to a clean state/.test(resetStatus)) failures.push('R did not visibly confirm profile reset');
    await cdp.send('Page.reload', { ignoreCache: true });
    await awaitBoot();
    const resetProfile = JSON.parse(await cdp.eval(`localStorage.getItem(${JSON.stringify(profileKey)})`));
    if (resetProfile.version !== 1 || resetProfile.sessions_started !== 0 || resetProfile.sessions_completed !== 0) {
      failures.push(`profile reset persisted unexpected state: ${JSON.stringify(resetProfile)}`);
    }
    process.stdout.write(`profile probe: recovered ${recoveryReason}, then reset clean\n\n`);

    const capture = async (name) => {
      if (!args.captureDir) return;
      const file = join(args.captureDir, `${name}.png`);
      await cdp.screenshot(file);
      captures.push(file);
      process.stdout.write(`   [capture] ${name}.png\n`);
    };

    /** Press a key and wait until the page's event count actually advances. */
    const press = async (label, code, { expectAdvance = true } = {}) => {
      const before = JSON.parse(await cdp.eval(stateExpr));
      await cdp.key(code);
      let after = before;
      try {
        const raw = await waitFor(
          cdp,
          `(function(){var s=window.__scv.getState();`
          + `return s.events.length>${before.events} ? ${stateExpr} : null})()`,
          `page reaction to ${label}`,
          5000,
        );
        after = JSON.parse(raw);
      } catch (err) {
        if (expectAdvance) throw err;
        after = JSON.parse(await cdp.eval(stateExpr));
      }
      timeline.push({ label, key: code, status: after.status, events: after.events });
      process.stdout.write(`  ${label.padEnd(42)} events=${String(after.events).padStart(2)} | ${after.status}\n`);
      return after;
    };

    // ---------------------------------------------------- launch capture
    await capture('01-launch');

    // ------------------------------------------------ invalid-first probe
    let blockedProbes = 0;
    if (args.invalidFirst) {
      process.stdout.write('-- invalid path FIRST: evidence disposition and exit before requirements --\n');
      await press('F disposition before session start', 'KeyF', { expectAdvance: false });
      await press('Enter start session', 'Enter');

      // Named block 1: evidence disposition before the reveal.
      const s1 = await press('F disposition before reveal', 'KeyF');
      if (!/Blocked disposition: missing reveal_decayed_surface/.test(s1.status)) {
        failures.push(`disposition block did not name reveal_decayed_surface: ${s1.status}`);
      } else blockedProbes += 1;
      await capture('02-blocked-disposition-before-reveal');

      // Named block 2: attempting the reveal while cleaning is incomplete must
      // identify the final cleaning prerequisite, not merely do nothing.
      const s2 = await press('Q reveal with cleaning incomplete', 'KeyQ');
      if (!/Blocked reveal_decayed_surface: missing strip_deck/.test(s2.status)) {
        failures.push(`early reveal block did not name strip_deck: ${s2.status}`);
      } else blockedProbes += 1;
      await capture('03-blocked-reveal-cleaning-incomplete');

      // Completion/exit is separately blocked and must not print success or
      // emit scenario_completed while debris and every cleaning pass remain.
      const s3 = await press('Enter complete with debris remaining', 'Enter');
      if (!/Blocked: Inspect the cleanup objective board still pending/.test(s3.status)) {
        failures.push(`early completion did not name the pending objective: ${s3.status}`);
      } else blockedProbes += 1;
      if (s3.finished || /Scenario complete/.test(s3.status)) {
        failures.push('scenario reported completion while requirements were outstanding');
      }
      const prematureCompleted = await cdp.eval(
        'window.__scv.getState().events.some(function(e){return e.event==="scenario_completed"})',
      );
      if (prematureCompleted) failures.push('scenario_completed was emitted on the invalid-first path');
      await capture('04-blocked-exit-with-debris');

      const blockedEvents = JSON.parse(await cdp.eval(
        'JSON.stringify(window.__scv.getState().events.filter(function(e){return e.event==="invalid_action_blocked"}))',
      ));
      process.stdout.write(`   invalid_action_blocked events so far: ${blockedEvents.length}\n`);
      if (blockedEvents.length < 3) failures.push(`expected >=3 invalid_action_blocked events, got ${blockedEvents.length}`);
      const dispositionBlock = blockedEvents.find((e) => e.payload.attempted === 'disposition');
      const revealBlock = blockedEvents.find((e) => e.payload.attempted === 'reveal_decayed_surface');
      if (JSON.stringify(dispositionBlock?.payload.missing) !== JSON.stringify(['reveal_decayed_surface'])) {
        failures.push('disposition telemetry did not name reveal_decayed_surface');
      }
      if (JSON.stringify(revealBlock?.payload.missing) !== JSON.stringify(['strip_deck'])) {
        failures.push('reveal telemetry did not name strip_deck');
      }

      process.stdout.write('\n-- recovery: valid replay after the invalid attempts --\n');
    } else {
      process.stdout.write('-- happy path --\n');
      await press('Enter start session', 'Enter');
    }

    // ------------------------------------------------------- valid replay
    let beforeCleanCaptured = false;
    for (const stepId of descriptor.replay) {
      const step = descriptor.steps.find((s) => s.id === stepId);
      await press(`${KEY_FOR_KIND[step.kind]} ${step.id}`, KEY_FOR_KIND[step.kind]);

      if (step.id === 'inspect_objective' && !beforeCleanCaptured) {
        await capture('05-before-clean-gold-staged');
        beforeCleanCaptured = true;
      }
      if (step.id === 'strip_deck') await capture('06-after-clean-coat-stripped');
      if (step.id === 'reveal_decayed_surface') await capture('07-reveal-decayed-surface');
    }

    const afterSteps = JSON.parse(await cdp.eval(stateExpr));
    const missingSteps = descriptor.steps.map((s) => s.id).filter((id) => !afterSteps.completed.includes(id));
    if (missingSteps.length) failures.push(`steps never completed in browser: ${missingSteps.join(', ')}`);

    // ------------------------------------------------------ complete + hook
    const done = await press('Enter complete scenario', 'Enter');
    if (!done.finished) failures.push('scenario did not finish after all steps completed');
    await capture('08-completed-next-hook');

    const finalStatus = done.status;
    if (!finalStatus.includes(descriptor.next_hook.label)) {
      failures.push(`completion status did not show the next-room hook: ${finalStatus}`);
    }
    const duplicateBefore = done.events;
    const duplicate = await press('Enter after completion', 'Enter', { expectAdvance: false });
    if (!/Session finished/.test(duplicate.status) || duplicate.events !== duplicateBefore) {
      failures.push('post-completion advance produced misleading output or extra telemetry');
    }

    // ---------------------------------------------------------- telemetry
    const events = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.getState().events)'));
    const validation = JSON.parse(await cdp.eval('JSON.stringify(window.__scv.validate())'));
    const names = events.map((e) => e.event);

    const REQUIRED = [
      'session_started', 'core_action_completed', 'signature_reveal_seen',
      'choice_committed', 'scenario_completed', 'session_ended',
    ];
    const missing = REQUIRED.filter((r) => !names.includes(r));
    if (missing.length) failures.push(`missing required events: ${missing.join(', ')}`);
    if (!validation.ok) failures.push(`telemetry invalid: ${validation.errors.join('; ')}`);

    const coreActions = names.filter((n) => n === 'core_action_completed').length;
    if (coreActions < 3) failures.push(`only ${coreActions} core actions in the browser run`);

    const buildIds = new Set(events.map((e) => e.build_id));
    if (buildIds.size !== 1) failures.push(`telemetry mixes build_ids: ${[...buildIds].join(', ')}`);

    // The reveal must precede the choice on the real surface, not just on paper.
    if (names.indexOf('signature_reveal_seen') > names.indexOf('choice_committed')) {
      failures.push('choice_committed preceded signature_reveal_seen in the browser');
    }
    if (!names.includes('next_hook_shown')) failures.push('next hook was never shown');

    process.stdout.write(`\nevent stream (${events.length}):\n  ${names.join('\n  -> ')}\n`);
    process.stdout.write(`\nschema validation      : ${validation.ok ? 'VALID' : 'INVALID'}\n`);
    process.stdout.write(`required events        : ${missing.length === 0 ? 'ALL 6 PRESENT' : 'MISSING ' + missing.join(', ')}\n`);
    process.stdout.write(`core actions performed : ${coreActions}\n`);
    process.stdout.write(`invalid blocks observed: ${names.filter((n) => n === 'invalid_action_blocked').length}\n`);
    process.stdout.write(`build_id in telemetry  : ${[...buildIds].join(', ')}\n`);

    if (args.captureDir) {
      writeFileSync(
        join(args.captureDir, 'browser-session.json'),
        `${JSON.stringify({
          concept_id: CONCEPT_ID,
          build_id: [...buildIds][0],
          invalid_first: args.invalidFirst,
          blocked_probes: blockedProbes,
          profile_probe: { recovery_reason: recoveryReason, reset_profile: resetProfile },
          served_proof: {
            set: servedScenario.set,
            visible_proof: servedScenario.visible_proof,
            disposition_options: optionIds,
            next_hook: servedScenario.next_hook,
          },
          events,
          validation,
          timeline,
          captures,
        }, null, 2)}\n`,
      );
    }

    const ok = failures.length === 0;
    process.stdout.write(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}\n`);
    for (const f of failures) process.stdout.write(`   FAIL ${f}\n`);
    await fetch(`http://127.0.0.1:${args.cdp}/json/close/${tab.id}`).catch(() => {});
    cdp.close();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    await fetch(`http://127.0.0.1:${args.cdp}/json/close/${tab.id}`).catch(() => {});
    cdp.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`browser-qa failed: ${err.message}\n`);
  process.exit(1);
});
