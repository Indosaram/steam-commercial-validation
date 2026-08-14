#!/usr/bin/env node
/**
 * Local launcher for the modular candidate shell.
 *
 * Serves shared shell/core modules plus ONLY the active candidate directory.
 * Candidate browser code is optional: candidates/<concept_id>/game.js is
 * exposed as /candidate/game.js and announced in bootstrap.json when present.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { extname, join, dirname, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONCEPT_IDS, getConcept, CONCEPTS } from '../core/concepts.js';
import { INPUT_MAP } from '../core/input.js';
import { schemaDescriptor } from '../core/telemetry.js';
import { buildIdentity, candidateDir } from '../core/build-identity.js';
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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--concept') args.concept = argv[++i] ?? null;
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--host') args.host = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function safeTarget(baseDir, relPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return null;
  }

  // Reject traversal before normalization. normalize('/../x') collapses to
  // '/x', which is still inside baseDir; accepting that would hide an escape
  // attempt instead of explicitly rejecting it.
  const segments = decoded.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..')) return null;

  const withLeadingSlash = decoded.startsWith('/') ? decoded : `/${decoded}`;
  const target = resolve(baseDir, `.${normalize(withLeadingSlash)}`);
  if (target === baseDir || target.startsWith(`${baseDir}${sep}`)) return target;
  return null;
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

  if (!args.concept) {
    process.stderr.write(`launch rejected: missing required --concept <concept_id>\n\n${HELP}`);
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

  const activeCandidateDir = candidateDir(concept.concept_id);
  const candidateGameFile = join(activeCandidateDir, 'game.js');
  const gameModule = isRegularFile(candidateGameFile) ? '/candidate/game.js' : null;
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
    game_module: gameModule,
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
      res.end(JSON.stringify({
        ok: true,
        concept_id: concept.concept_id,
        build_id: identity.build_id,
        build_hash: identity.build_hash,
        scenario_source: scenarioSource,
        scenario_steps: scenario?.steps.length ?? 0,
        game_module: gameModule,
      }));
      return;
    }

    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const isCore = rel.startsWith('/core/');
    const isCandidate = rel.startsWith('/candidate/');

    let baseDir = SHELL_DIR;
    let relPath = rel;
    if (isCore) {
      baseDir = CORE_DIR;
      relPath = rel.slice('/core'.length);
    } else if (isCandidate) {
      baseDir = activeCandidateDir;
      relPath = rel.slice('/candidate'.length);
    }

    const target = safeTarget(baseDir, relPath);
    if (!target) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }

    try {
      const body = await readFile(target);
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });

  server.on('error', (err) => {
    process.stderr.write(`launch failed: ${err.message}\n`);
    process.exit(1);
  });

  server.listen(args.port, args.host, () => {
    process.stdout.write([
      `concept_id : ${concept.concept_id}`,
      `title      : ${concept.title}`,
      `role       : ${concept.role}`,
      `build_id   : ${identity.build_id}`,
      `scenario   : ${scenario ? `candidate (${scenario.steps.length} steps)` : 'blank shell'}`,
      `game       : ${gameModule ?? 'neutral blank-shell fallback'}`,
      `url        : http://${args.host}:${args.port}/`,
      '',
      'Internal validation shell. Not a public demo. Ctrl-C to stop.',
      '',
    ].join('\n'));
  });

  const shutdown = (signal) => {
    process.stdout.write(`\nreceived ${signal}, shutting down cleanly\n`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
