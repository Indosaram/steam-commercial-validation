#!/usr/bin/env node
/**
 * Deterministic smoke driver.
 *
 * Exercises all five concept IDs through the blank candidate shell from a
 * fresh profile each time, validates the emitted telemetry against the shared
 * schema, and exports a scorecard set plus a decision-log record per concept.
 *
 * Usage:
 *   node tools/smoke-driver.js [--out <dir>] [--seed <n>] [--concept <id>]
 *   node tools/smoke-driver.js --help
 *
 * Exit codes: 0 all concepts passed, 1 at least one failed, 2 bad invocation.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CONCEPT_IDS, getConcept } from '../core/concepts.js';
import { validateSession, schemaDescriptor } from '../core/telemetry.js';
import { createProfile, loadProfile, saveProfile } from '../core/profile.js';
import { runScenario, evaluateSuccessCondition, BUILD_ID } from '../core/shell-core.js';
import { buildScorecard, validateScorecard, renderComparisonTable } from '../core/scorecard.js';
import { buildDecisionRecord, renderDecisionLog } from '../core/decision-log.js';

function parseArgs(argv) {
  const args = { out: null, seed: 1, concepts: [...CONCEPT_IDS], help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--concept') args.concepts = [argv[++i]];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(args.seed)) throw new Error('--seed must be a number');
  return args;
}

const HELP = `steam-commercial-validation smoke driver

  node tools/smoke-driver.js [options]

  --out <dir>      write run artifacts to <dir> (default: runs/smoke-<timestamp>)
  --seed <n>       deterministic seed (default: 1)
  --concept <id>   run a single concept instead of all five
  --help           show this message

Concept IDs: ${CONCEPT_IDS.join(', ')}
`;

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(args.out ?? join(process.cwd(), 'runs', `smoke-${stamp}`));
  const profileRoot = join(outDir, 'profiles');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(profileRoot, { recursive: true });

  process.stdout.write(`build_id: ${BUILD_ID}\nseed: ${args.seed}\nout: ${outDir}\n\n`);

  const results = [];
  const scorecards = [];
  const decisions = [];

  for (const conceptId of args.concepts) {
    const result = { concept_id: conceptId, checks: {}, ok: false, errors: [] };
    try {
      const concept = getConcept(conceptId);

      // Fresh profile per concept: the plan requires a new-profile launch.
      const fresh = createProfile({ root: profileRoot, conceptId });
      result.checks.fresh_profile_created = fresh.sessions_started === 0;

      const session = runScenario({ conceptId, seed: args.seed });

      const schema = validateSession(session.events);
      result.checks.telemetry_schema_valid = schema.ok;
      if (!schema.ok) result.errors.push(...schema.errors);

      const success = evaluateSuccessCondition(session);
      result.checks.success_condition_met = success.ok;
      result.active_minutes = success.active_minutes;
      result.success_detail = success.checks;
      if (!success.ok) {
        for (const [k, v] of Object.entries(success.checks)) {
          if (!v) result.errors.push(`success condition failed: ${k}`);
        }
      }

      // Record the session against the profile and persist it.
      const profile = loadProfile({ root: profileRoot, conceptId });
      profile.sessions_started += 1;
      profile.sessions_completed += 1;
      profile.last_session_id = session.session_id;
      saveProfile({ root: profileRoot, conceptId, profile });
      const reloaded = loadProfile({ root: profileRoot, conceptId });
      result.checks.profile_persisted =
        reloaded.sessions_completed === 1 && reloaded.recovered === false;

      // Scorecard export. Neutral 3s: the foundation must not invent owner
      // opinions - these are placeholders the owner overwrites at Task 8.
      const card = buildScorecard({
        session,
        ratings: Object.fromEntries(
          [
            'role_clarity',
            'first_payoff_timing',
            'repeated_action_satisfaction',
            'signature_reveal_memorability',
            'meaningful_choice',
            'next_scenario_desire',
            'five_to_ten_hour_potential',
          ].map((d) => [d, 3]),
        ),
        notes: 'placeholder ratings emitted by the smoke driver; not owner input',
        recorded_at: new Date().toISOString(),
      });
      const cardCheck = validateScorecard(card);
      result.checks.scorecard_valid = cardCheck.ok;
      if (!cardCheck.ok) result.errors.push(...cardCheck.errors);
      scorecards.push(card);

      const decision = buildDecisionRecord({
        session,
        decision: 'hold',
        rationale: 'blank foundation shell verified; candidate content pending Tasks 2-6',
        known_limitations: [
          'no candidate-specific content, art, or scenario logic',
          'scripted play-through, not human input',
        ],
        recorded_at: new Date().toISOString(),
      });
      decisions.push(decision);
      result.checks.decision_record_built = true;

      writeFileSync(
        join(outDir, `${conceptId}.session.json`),
        `${JSON.stringify({ concept: concept.title, ...session }, null, 2)}\n`,
        'utf8',
      );

      result.ok = Object.values(result.checks).every(Boolean) && result.errors.length === 0;
      result.session_id = session.session_id;
    } catch (err) {
      result.errors.push(`exception: ${err.message}`);
      result.ok = false;
    }
    results.push(result);
    process.stdout.write(
      `${result.ok ? 'PASS' : 'FAIL'}  ${conceptId}  (${result.active_minutes ?? '?'} min)\n`,
    );
    for (const e of result.errors) process.stdout.write(`        ! ${e}\n`);
  }

  writeFileSync(
    join(outDir, 'scorecards.json'),
    `${JSON.stringify(scorecards, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(join(outDir, 'scorecards.md'), `${renderComparisonTable(scorecards)}\n`, 'utf8');
  writeFileSync(
    join(outDir, 'decision-log.json'),
    `${JSON.stringify(decisions, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(outDir, 'decision-log.md'),
    renderDecisionLog(decisions, { title: 'Task 1 foundation decision log' }),
    'utf8',
  );
  writeFileSync(
    join(outDir, 'telemetry-schema.json'),
    `${JSON.stringify(schemaDescriptor(), null, 2)}\n`,
    'utf8',
  );

  const passed = results.filter((r) => r.ok).length;
  const summary = {
    build_id: BUILD_ID,
    seed: args.seed,
    generated_at: new Date().toISOString(),
    concepts_run: args.concepts.length,
    concepts_passed: passed,
    all_passed: passed === args.concepts.length,
    results,
  };
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  process.stdout.write(`\n${passed}/${args.concepts.length} concepts passed\n`);
  process.stdout.write(`artifacts: ${outDir}\n`);

  // Clean up scratch profiles created by this run; the exported artifacts stay.
  rmSync(profileRoot, { recursive: true, force: true });

  process.exit(summary.all_passed ? 0 : 1);
}

main();
