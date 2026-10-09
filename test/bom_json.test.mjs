import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFileSync } from '../src/utils/json_io.js';
import { readJsonCached } from '../src/utils/json_io.js';

// C251 (2026-06-18, 90min dead-idle): PowerShell's Set-Content/Out-File writes UTF-8 WITH a BOM; Node's
// JSON.parse throws on it and a silent catch turned that into "no sticky dispatch ever again".
// T-0116: the fix only covered bridge.mjs — v0.2.0's agent.js respawn re-arm and readJsonCached
// parsed raw again.

const BOM = '﻿';
const tmp = (name, content) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-bom-'));
    const f = path.join(dir, name);
    fs.writeFileSync(f, content, 'utf8');
    return f;
};

test('T-0116/C251: BOM-prefixed sticky_skill.json (PowerShell-written) still parses', () => {
    const f = tmp('sticky_skill.json', BOM + JSON.stringify({ skill: 'kernelDriver', args: [] }));
    assert.deepEqual(readJsonFileSync(f), { skill: 'kernelDriver', args: [] });
});

test('C251: a genuinely corrupt file is reported, never swallowed silently; a missing file is just null', () => {
    const errs = [];
    assert.equal(readJsonFileSync(tmp('x.json', '{"skill":'), { onError: (e) => errs.push(e) }), null);
    assert.equal(errs.length, 1);
    assert.equal(readJsonFileSync(path.join(os.tmpdir(), 'neko-definitely-missing.json'), { onError: (e) => errs.push(e) }), null);
    assert.equal(errs.length, 1, 'ENOENT is the normal default case, not an error');
});

test('T-0116: readJsonCached (advisory.json surfaceGate override / dzone) reads a BOM file', () => {
    const f = tmp('advisory.json', BOM + JSON.stringify({ surfaceGate: { mode: 'committed_underground' } }));
    assert.equal(readJsonCached(f, 0)?.surfaceGate?.mode, 'committed_underground');
});

test('T-0116: every reader of sticky_skill.json in the codebase is BOM-safe', () => {
    // A new read path (like agent.js's respawn re-arm) that does a raw JSON.parse silently resurrects C251.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (!/node_modules|\.git|test$/.test(e.name)) walk(p); }
            else if (/\.(m?js|cjs)$/.test(e.name)) files.push(p);
        }
    };
    walk(path.join(root, 'src'));
    for (const f of fs.readdirSync(path.join(root, 'bots', '_supervisor'))) if (/\.m?js$/.test(f)) files.push(path.join(root, 'bots', '_supervisor', f));
    walk(path.join(root, 'bots', '_supervisor', 'skills'));
    const offenders = [];
    for (const f of files) {
        const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
            if (!/sticky_skill\.json|STICKY\b/.test(l) || !/readFileSync/.test(l)) return;
            const win = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
            const safe = /readJsonFileSync|readJsonFile\(|FEFF|﻿|\\uFEFF/.test(win) || !/JSON\.parse/.test(win);
            if (!safe) offenders.push(`${path.relative(root, f)}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, []);
});
