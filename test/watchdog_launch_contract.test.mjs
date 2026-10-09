import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// T-0109: watchdog.ps1 kept launching bots/_supervisor/overseer.mjs after that file was lost → node died
// with MODULE_NOT_FOUND every ~1 min for 8.5 days, and the risk engine's advisory.json went stale (old-world
// dzone → false inDeathZone → part of the T-0106 freeze). Every keep-alive launch must target a script that
// exists in the repo, or be wrapped in a Test-Path guard.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0109: every supervisor script watchdog.ps1 launches exists, or its launch is Test-Path guarded', () => {
    const lines = fs.readFileSync(path.join(root, 'watchdog.ps1'), 'utf8').split(/\r?\n/);
    const problems = [];
    let launches = 0;
    lines.forEach((l, i) => {
        if (/^\s*#/.test(l)) return;                                         // commented-out keep-alives
        const m = l.match(/Start-Process\s+-FilePath\s+'node'\s+-ArgumentList\s+'([\w.-]+\.mjs)'/);
        if (!m) return;
        launches++;
        const script = m[1];
        if (fs.existsSync(path.join(root, 'bots', '_supervisor', script))) return;
        const before = lines.slice(Math.max(0, i - 12), i).join('\n');
        const guarded = /Test-Path/.test(before) && before.includes(script.replace(/\.mjs$/, ''));
        if (!guarded) problems.push(`watchdog.ps1:${i + 1} launches missing ${script} without a Test-Path guard`);
    });
    assert.ok(launches >= 4, `expected the keep-alive launches to be found (got ${launches})`);
    assert.deepEqual(problems, []);
});
