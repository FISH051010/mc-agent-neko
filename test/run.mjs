// `npm test` entry: runs every test/**/*.test.mjs inside a throwaway runtime home.
//
// ★2026-10-09: tests used to run with cwd = repo root, and 36 hot-loaded skills resolve their
// runtime state as path.resolve(process.cwd(), 'bots', '_supervisor', ...). So
// placement_recovery.sim.test.mjs → smeltSafe registered a fake furnace @1,2,3 straight into the
// LIVE bot's stations.json while the bot was playing. Every test now gets cwd = MC_AGENT_HOME =
// a fresh temp dir, so neither process.cwd()- nor dataPath()-based writers can reach real state.
//
// ★2026-10-11 SOURCE SNAPSHOT (world_scope "flaky only in full parallel runs"): the suite read the LIVE working tree
// for a minute or more (imports + source-scan tests), while other sessions edit files in the same checkout and
// deploy-lock runs this from that shared checkout. Editors write non-atomically (truncate → write), so a test could
// read a half-written agent.js — reproduced: rewriting agent.js in a loop made world_scope's T-0228 source scan fail
// 23/25 runs ('expected initial + reconnect creation sites'). Now the run executes against ONE consistent snapshot of
// the working tree taken at start (tracked files incl. uncommitted edits + untracked non-ignored files), built through
// a private git index so the real index is never touched. NEKO_TEST_NO_SNAPSHOT=1 runs in place (old behaviour).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const liveTestDir = path.dirname(fileURLToPath(import.meta.url));
const liveRoot = path.resolve(liveTestDir, '..');

function collect (dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

// Consistent copy of the working tree via a private index: read-tree HEAD → add -A → checkout-index.
function snapshotWorkingTree () {
  if (process.env.NEKO_TEST_NO_SNAPSHOT === '1') return null;
  const base = mkdtempSync(path.join(tmpdir(), 'neko-test-src-'));
  const root = path.join(base, 'tree');
  const env = { ...process.env, GIT_INDEX_FILE: path.join(base, 'index') };
  const git = (args) => spawnSync('git', args, { cwd: liveRoot, env, stdio: 'ignore' }).status === 0;
  const tree = () => { const r = spawnSync('git', ['write-tree'], { cwd: liveRoot, env, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
  // Stable-read check: re-stage after extracting; if any file changed while we were copying (an edit in flight), the
  // tree hash differs and we take the snapshot again — so we never run on a half-written file.
  let ok = false;
  for (let attempt = 0; attempt < 5 && !ok; attempt++) {
    if (!(git(['read-tree', 'HEAD']) && git(['add', '-A']))) break;
    const t1 = tree();
    if (!t1 || !git(['checkout-index', '-a', '-f', `--prefix=${root.replace(/\\/g, '/')}/`])) break;
    ok = git(['add', '-A']) && tree() === t1;
    if (!ok) { try { rmSync(root, { recursive: true, force: true }); } catch { /* retake */ } }
  }
  if (!ok) {
    console.warn('[test/run] git snapshot failed — running against the live working tree');
    try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
    return null;
  }
  const nm = path.join(liveRoot, 'node_modules');
  if (existsSync(nm)) symlinkSync(nm, path.join(root, 'node_modules'), 'junction');
  return { base, root };
}

const snap = snapshotWorkingTree();
const root = snap ? snap.root : liveRoot;
const toRun = (f) => {                       // map a live path (CLI arg) into the snapshot
  const abs = path.resolve(f);
  const rel = path.relative(liveRoot, abs);
  return (snap && !rel.startsWith('..') && !path.isAbsolute(rel)) ? path.join(root, rel) : abs;
};

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map(toRun)
  // bots/_supervisor/test/ holds the hot-load skill tests (mineDown/forage/oracle…); they were never
  // in the old "test/**" glob, so they silently never ran under npm test.
  : [...collect(path.join(root, 'test')), ...collect(path.join(root, 'bots', '_supervisor', 'test'))].sort();

const home = mkdtempSync(path.join(tmpdir(), 'neko-test-home-'));
mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });

// A test that never settles (an unbounded wait, a leaked interval) must FAIL, not hang npm test / merge gates / deploy-lock
// forever: per-test timeout + force-exit (10-11: a mutated settleForDig loop hung the suite; with these it is 'cancelled', exit 1).
const TEST_ARGS = ['--test', '--test-timeout=120000', '--test-force-exit'];
const r = spawnSync(process.execPath, [...TEST_ARGS, ...files], {
  cwd: home,
  env: { ...process.env, MC_AGENT_HOME: home, NEKO_TEST_HOME: home, NEKO_TEST_LIVE_ROOT: liveRoot },
  stdio: 'inherit',
});
try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
// junction first (rmSync on the snapshot must not follow it into the real node_modules)
if (snap) {
  try { rmSync(path.join(snap.root, 'node_modules'), { force: true }); } catch { /* best effort */ }
  try { rmSync(snap.base, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.exit(r.status ?? 1);
