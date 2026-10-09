import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sealedEscapeStep } from '../src/agent/mobility_geom.js';

// Live 10-09 20:36:15 / 20:38:15: underground the bot's own mine tunnels are always "bounded", so the T-0135 escape
// episode (alive while sr.sealed) rode along for minutes — fighting branchMine:ore-window for the dig slot and, at
// 20:38:58.98, interrupting smeltSafe ('dispatch interrupted') with a SEALED dig 50ms later (GET_ARMOR smelt lost).
// A body that a skill is working (digging / smelting / crafting) is not trapped.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0163: a skill working the body ends the escape episode and never starts one', () => {
    const ep = { since: 0, lastAt: 0 };
    const on = sealedEscapeStep({ episode: ep, sr: { sealed: true }, enc: true, night: false, now: 1000, working: true });
    assert.equal(on.st, null, 'no SEALED reflex while branchMine/smelt owns the body');
    assert.equal(on.episode, null);
    const start = sealedEscapeStep({ episode: null, sr: { sealed: true }, enc: true, night: false, now: 1000, debounceSealed: true, working: true });
    assert.equal(start.st, null);
    assert.equal(start.episode, null);
    // idle in a genuinely sealed room → T-0135 behaviour unchanged
    assert.equal(sealedEscapeStep({ episode: ep, sr: { sealed: true }, enc: true, night: false, now: 1000, working: false }).st, 'SEALED');
});

test('T-0163: modes.js feeds the child skill (not just supervised_skill=kernel) and purposeful digs into the SEALED gate', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.doesNotMatch(src, /String\(agent\.supervised_skill \|\| bot\._currentSkill \|\| ''\)/,
        "supervised_skill is 'kernel' under kernelDriver → the || never reaches the smelt/craft child");
    assert.match(src, /const _sealedWorking = _stationaryTask \|\| purposefulDigActive\(bot, now\);/);
    assert.match(src, /if \(!_sr \|\| _sealedWorking\) \{ this\._sealedSince = 0;/);
    assert.match(src, /sealedEscapeStep\(\{[^}]*working: _sealedWorking/);
});
