import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// T-0049 / T-0056 drowning reflexes. The behavior is physics/timing (swim, oxygen, dig speed) and cannot be
// reproduced offline, so these are STRUCTURAL pins: each fix is a specific statement in modes.js's reflex
// bodies that a merge can silently drop. Behavioral backstop = live 'drowning' death-cause signal in
// death_log / botwatch. (The covered-pocket half of drowning — T-0098/T-0104 — is behavior-tested in
// test/submerged_trap.test.mjs.)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src', 'agent', 'modes.js'), 'utf8');
const region = (marker, len = 2500) => { const i = src.indexOf(marker); assert.ok(i >= 0, `marker missing: ${marker}`); return src.slice(i, i + len); };

test('T-0049/C311-A: a force-released reflex wedge IN WATER actively swims up (jump + look up), not just clears controls', () => {
    const r = region('★C311-A (T-0049)', 1600);
    assert.match(r, /setControlState\('jump', true\)/);
    assert.match(r, /bot\.look\(bot\.entity\.yaw, -1\.4/);
});

test('T-0049/C313-A: drowning with no air pocket in range and open WATER overhead → swim straight up (no slow dig/pillar in water)', () => {
    const r = region('★C313-A (T-0049)', 1400);
    assert.match(r, /if \(upB && \/water\/\.test\(upB\.name \|\| ''\)\)/);
    assert.match(r, /setControlState\('jump', true\)/);
});

test('T-0056/C314: before breaking a rock seal to escape drowning, equip a pickaxe (bare-hand stone ~7.5s/block > drowning window)', () => {
    const r = region('★C314 (T-0056)', 1200);
    const eq = r.indexOf('equipForBlock(head)');
    const dig = r.indexOf('bot.dig(head)');
    assert.ok(eq > 0 && dig > 0 && eq < dig, 'equipForBlock(head) must precede bot.dig(head)');
});
