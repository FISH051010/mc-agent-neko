// `npm test` entry: runs every test/**/*.test.mjs inside a throwaway runtime home.
//
// ★2026-10-09: tests used to run with cwd = repo root, and 36 hot-loaded skills resolve their
// runtime state as path.resolve(process.cwd(), 'bots', '_supervisor', ...). So
// placement_recovery.sim.test.mjs → smeltSafe registered a fake furnace @1,2,3 straight into the
// LIVE bot's stations.json while the bot was playing. Every test now gets cwd = MC_AGENT_HOME =
// a fresh temp dir, so neither process.cwd()- nor dataPath()-based writers can reach real state.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));

function collect (dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => path.resolve(f))
  // bots/_supervisor/test/ holds the hot-load skill tests (mineDown/forage/oracle…); they were never
  // in the old "test/**" glob, so they silently never ran under npm test.
  : [...collect(testDir), ...collect(path.join(testDir, '..', 'bots', '_supervisor', 'test'))].sort();

const home = mkdtempSync(path.join(tmpdir(), 'neko-test-home-'));
mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });

const r = spawnSync(process.execPath, ['--test', ...files], {
  cwd: home,
  env: { ...process.env, MC_AGENT_HOME: home, NEKO_TEST_HOME: home },
  stdio: 'inherit',
});
try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(r.status ?? 1);
