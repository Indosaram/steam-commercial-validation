#!/usr/bin/env node
/**
 * Local launcher for the blank candidate shell.
 *
 * Serves the shell as a real browser app on localhost using only the Node
 * standard library - no bundler, no package installs, no network fetch. This
 * is the "launch contract" every candidate build inherits:
 *
 *   node tools/launch.js --concept <concept_id> [--port <n>]
 *
 * A launch without --concept is rejected, which is the acceptance criterion
 * for missing concept_id at the launch boundary.
 *
 * This is an internal validation harness. It is not a Steam build, has no
 * store integration, and must never be published.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONCEPT_IDS, getConcept, CONCEPTS } from '../core/concepts.js';
import { INPUT_MAP } from '../core/input.js';
import { schemaDescriptor } from '../core/telemetry.js';
import { buildIdentity } from '../core/build-identity.js';
import { loadCandidateScenario } from '../core/candidate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(__dirname, '..');
const SHELL_DIR = join(WORKSPACE_DIR, 'shell');
const CORE_DIR = join(WORKSPACE_DIR, 'core');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const HELP = `steam-commercial-validation launcher

  node tools/launch.js --concept <concept_id> [--port <n>] [--host <h>]

  --concept <id>   REQUIRED. One of:
                   ${CONCEPT_IDS.join('\n                   ')}
  --port <n>       port to bind (default 8177)
  --host <h>       host to bind (default 127.0.0.1)
  --help           show this message
`;

function parseArgs(argv) {
  const args = { concept: null, port: 8177, host: '127.0.0.1', help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--concept') args.concept = argv[++i] ?? null;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
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

  // Launch contract: a missing or unknown concept_id is a hard, named failure.
  if (!args.concept) {
    process.stderr.write(
      `launch rejected: missing required --concept <concept_id>\n\n${HELP}`,
    );
    process.exit(2);
  }
  let concept;
  try {
    concept = getConcept(args.concept);
  } catch (err) {
    process.stderr.write(`launch rejected: ${err.message}\n`);
    process.exit(2);
  }

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    process.stderr.write(`launch rejected: invalid --port ${args.port}\n`);
    process.exit(2);
  }

  let scenario;
  try {
    scenario = await loadCandidateScenario(concept.concept_id);
  } catch (err) {
    process.stderr.write(`launch rejected: ${err.message}\n`);
    process.exit(2);
  }
  const scenarioSource = scenario ? 'candidate' : 'blank_shell';
  const identity = buildIdentity(concept.concept_id);
  const bootstrap = {
    concept,
    build_identity: identity,
    all_concepts: CONCEPTS,
    input_map: INPUT_MAP,
    telemetry_schema: schemaDescriptor(),
    scenario,
    scenario_source: scenarioSource,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/bootstrap.json') {
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify(bootstrap, null, 2));
      return;
    }

    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(
        JSON.stringify({
          ok: true,
          concept_id: concept.concept_id,
          build_id: identity.build_id,
          build_hash: identity.build_hash,
          scenario_source: scenarioSource,
          scenario_steps: scenario?.steps.length ?? 0,
        }),
      );
      return;
    }

    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    // The shell imports the shared core modules directly, so both directories
    // are served. Everything else on disk stays unreachable.
    const isCore = rel.startsWith('/core/');
    const baseDir = isCore ? CORE_DIR : SHELL_DIR;
    const relPath = isCore ? rel.slice('/core'.length) : rel;

    // Contain path traversal: resolve, then verify the result stays in baseDir.
    const target = resolve(join(baseDir, normalize(relPath)));
    if (target !== baseDir && !target.startsWith(baseDir + '/')) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }

    try {
      const body = await readFile(target);
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });

  server.on('error', (err) => {
    process.stderr.write(`launch failed: ${err.message}\n`);
    process.exit(1);
  });

  server.listen(args.port, args.host, () => {
    process.stdout.write(
      [
        `concept_id : ${concept.concept_id}`,
        `title      : ${concept.title}`,
        `role       : ${concept.role}`,
        `build_id   : ${identity.build_id}`,
        `scenario   : ${scenario ? `candidate (${scenario.steps.length} steps)` : 'blank shell'}`,
        `url        : http://${args.host}:${args.port}/`,
        '',
        'Internal validation shell. Not a public demo. Ctrl-C to stop.',
        '',
      ].join('\n'),
    );
  });

  // Clean shutdown so a mid-operation interrupt never leaves a bound port.
  const shutdown = (signal) => {
    process.stdout.write(`\nreceived ${signal}, shutting down cleanly\n`);
    server.close(() => process.exit(0));
    // Force-exit if sockets linger past a grace period.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
