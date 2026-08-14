#!/usr/bin/env node
/**
 * Standalone validator for exported artifacts.
 *
 * Validates a telemetry session export, a scorecard export, or a whole smoke
 * run directory against the shared schemas. Candidate builds (Tasks 2-6) and
 * the packaging step (Task 7) use this as the single conformance gate.
 *
 * Usage:
 *   node tools/validate-export.js <path> [<path>...]
 *
 * A path may be a *.session.json, a scorecards.json, or a run directory.
 * Exit codes: 0 all valid, 1 at least one invalid, 2 bad invocation.
 */

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { validateSession } from '../core/telemetry.js';
import { validateScorecard } from '../core/scorecard.js';

function fail(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function readJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    return { ok: false, error: `unreadable or invalid JSON: ${err.message}` };
  }
}

function validateFile(path) {
  const parsed = readJson(path);
  if (!parsed.ok) return { path, kind: 'unknown', ok: false, errors: [parsed.error] };
  const value = parsed.value;

  if (Array.isArray(value) && value.length > 0 && value[0]?.scorecard_version !== undefined) {
    const errors = [];
    value.forEach((card, i) => {
      const r = validateScorecard(card);
      if (!r.ok) errors.push(...r.errors.map((e) => `scorecard[${i}]: ${e}`));
    });
    return { path, kind: 'scorecards', ok: errors.length === 0, errors };
  }

  if (value && typeof value === 'object' && Array.isArray(value.events)) {
    const r = validateSession(value.events);
    return { path, kind: 'session', ok: r.ok, errors: r.errors };
  }

  if (Array.isArray(value) && value.every((e) => e && typeof e === 'object' && 'event' in e)) {
    const r = validateSession(value);
    return { path, kind: 'session', ok: r.ok, errors: r.errors };
  }

  if (value && typeof value === 'object' && value.scorecard_version !== undefined) {
    const r = validateScorecard(value);
    return { path, kind: 'scorecard', ok: r.ok, errors: r.errors };
  }

  return { path, kind: 'unknown', ok: false, errors: ['unrecognized artifact shape'] };
}

function expand(path) {
  if (!existsSync(path)) return { missing: true, files: [] };
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path)
      .filter((f) => f.endsWith('.session.json') || f === 'scorecards.json')
      .map((f) => join(path, f));
    return { missing: false, files };
  }
  return { missing: false, files: [path] };
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    fail('usage: node tools/validate-export.js <path> [<path>...]');
  }

  const results = [];
  for (const t of targets) {
    const { missing, files } = expand(t);
    if (missing) {
      results.push({ path: t, kind: 'missing', ok: false, errors: ['path does not exist'] });
      continue;
    }
    if (files.length === 0) {
      results.push({ path: t, kind: 'empty', ok: false, errors: ['no validatable artifacts found'] });
      continue;
    }
    for (const f of files) results.push(validateFile(f));
  }

  for (const r of results) {
    process.stdout.write(`${r.ok ? 'VALID  ' : 'INVALID'} [${r.kind}] ${r.path}\n`);
    for (const e of r.errors) process.stdout.write(`         ! ${e}\n`);
  }

  const bad = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - bad}/${results.length} artifacts valid\n`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
