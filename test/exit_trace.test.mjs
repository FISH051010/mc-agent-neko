import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const traceUrl = pathToFileURL(path.join(repoRoot, 'src', 'process', 'exit_trace.js')).href;

// 2026-10-10: a silent main/agent exit at 21:41 could not be told apart from a deploy kill.
test('2026-10-10: a code-path process.exit() leaves an exit_log record with code and caller stack', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neko-exit-')), 'exit_log.jsonl');
  const src = `const { installExitTrace } = await import(${JSON.stringify(traceUrl)}); installExitTrace(${JSON.stringify(file)}); function cleanKill(){ process.exit(3); } cleanKill();`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src]);
  assert.equal(r.status, 3);
  const recs = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ex = recs.find((x) => x.kind === 'process.exit');
  assert.equal(ex.code, 3);
  assert.ok(ex.stack.some((l) => /cleanKill/.test(l)), JSON.stringify(ex.stack));
});
