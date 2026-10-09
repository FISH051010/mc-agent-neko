import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// ★T-0124: f25d080 (T-0121) + bc3acf2 (T-0123) called purposefulDigActive() inside mobility's classification but never imported
// it from framework/mobility_signals.js. Every FREE-branch tick threw ReferenceError into
// `catch (e) { return; }` → bot._mobility was never written again (vitals mob='?'/stale ENTOMBED) for 1h+,
// freezing kernelDriver dispatch twice (10-10 00:59 day, 01:09 night). Functions keep being extracted out of
// modes.js into modules — pin the whole class: modes.js may not call an exported helper of a sibling module
// unless it imports it (or defines one of the same name itself).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = path.join(root, 'src', 'agent');

function moduleFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
        d.isDirectory() ? moduleFiles(path.join(dir, d.name)) : (/\.m?js$/.test(d.name) ? [path.join(dir, d.name)] : []));
}

test('T-0124: modes.js imports every sibling-module helper it calls (no silent ReferenceError in reflex ticks)', () => {
    const src = fs.readFileSync(path.join(agentDir, 'modes.js'), 'utf8');
    const imported = new Set();
    for (const m of src.matchAll(/^import\s+\{([^}]*)\}\s+from/gm)) {
        for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); }
    }
    const exported = new Map();
    for (const f of moduleFiles(agentDir)) {
        if (path.basename(f) === 'modes.js') continue;
        const s = fs.readFileSync(f, 'utf8');
        for (const m of s.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) exported.set(m[1], path.relative(root, f));
    }
    // code only: drop line/block comments and string/template literals (mentions like `!vetoInstinct("x")`
    // in chat text or `isGoalDone(MIGRATE)` in comments are not calls)
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\\n])*\1/g, '""')
        .replace(/\/\/[^\n]*/g, ' ');
    const missing = [];
    for (const [name, file] of exported) {
        if (imported.has(name)) continue;
        const called = new RegExp(String.raw`(?<![.\w$])${name}\(`).test(code);
        if (!called) continue;
        const local = new RegExp(String.raw`(function\s+${name}\b|(const|let|var)\s+${name}\s*=|^\s*(async\s+)?${name}\s*\([^)]*\)\s*\{|${name}\s*:\s*(async\s+)?(function|\()|[(,]\s*${name}\s*[,)=]|\b${name}\s*=>)`, 'm').test(code);
        if (!local) missing.push(`${name} (exported by ${file})`);
    }
    assert.deepEqual(missing, [], `modes.js calls these without importing them:\n  ${missing.join('\n  ')}`);
});
