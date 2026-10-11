import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// T-0258 hardening (worker-tests): surface_judge_sole_source pins only the literal `skyLight >= 14`, so a fourth
// hand-written sky test spelled `skyLight > 13`, `skyLight === 15`, `skyLight>=15` or `b['skyLight']` slipped through
// (mutation-checked 10-11). Any code use of skyLight outside surface_judge.js is a new private "on the surface?" test — read the
// verdict from surface_judge (skyOpenAt / onSurfaceNow) instead. Full-line comments are ignored.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JUDGE = path.join(root, 'src', 'agent', 'framework', 'surface_judge.js');
function jsFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...jsFiles(p)); }
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}
const ALL = [...jsFiles(path.join(root, 'src')), ...jsFiles(path.join(root, 'bots', '_supervisor', 'skills'))];

function rawSkyLightOffenders(files, judge = JUDGE) {
    const out = [];
    for (const p of files) {
        if (p === judge) continue;
        const code = fs.readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        const m = /\bskyLight\b[^\n]*/.exec(code);   // b.skyLight / b['skyLight'] / const { skyLight } = b
        if (m) out.push(`${path.relative(root, p)}: ${m[0].trim().slice(0, 80)}`);
    }
    return out;
}

test('T-0258: no module outside surface_judge.js uses skyLight in code (any comparison or access spelling)', () => {
    assert.deepEqual(rawSkyLightOffenders(ALL), []);
});
