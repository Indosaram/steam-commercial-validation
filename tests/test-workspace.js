import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = resolve(__dirname, '..');

/**
 * Copy the shared foundation into a disposable workspace with no candidate
 * content. Tests can exercise the real path-based loaders without reading or
 * mutating candidate directories owned by Tasks 2-6.
 */
export function createFoundationWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'scv-foundation-'));
  for (const entry of ['core', 'shell', 'tools']) {
    cpSync(join(SOURCE_WORKSPACE, entry), join(workspace, entry), { recursive: true });
  }
  cpSync(join(SOURCE_WORKSPACE, 'package.json'), join(workspace, 'package.json'));
  mkdirSync(join(workspace, 'candidates'));
  return workspace;
}

export function removeFoundationWorkspace(workspace) {
  rmSync(workspace, { recursive: true, force: true });
}

export function importWorkspaceModule(workspace, relativePath) {
  return import(pathToFileURL(join(workspace, relativePath)).href);
}
