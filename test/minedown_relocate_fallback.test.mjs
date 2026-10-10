import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { goToColumn, relocateFallback } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 00:04:25/30 @-5,48,7 (aquifer area, all headings remembered): the START relocate found no dry 9-cell tunnel
// line and fell back to skills.moveAway — 0.2b moved, then the next one hung 43s until a restart. moveAway (GoalInvert)
// has never moved the bot underground. Underground: walk the bot's own tunnels to a solid column, else fail fast.
const solidRock = (x, y, z) => ({ name: 'stone', boundingBox: 'block' });   // nowhere to stand within 24b
const mkBot = () => {
    const b = { entity: { position: { x: -4.5, y: 48, z: 7.5 } }, stopped: 0, moved: 0, _mobility: { enclosed: true } };
    b.pathfinder = { stop: () => { b.stopped++; } };
    b.clearControlStates = () => {};
    return b;
};

test('T-0193: underground with no reachable solid column → fast honest fail, never moveAway', async () => {
    const bot = mkBot();
    const logs = [];
    const skills = { moveAway: async () => { bot.moved++; }, goToPosition: async () => {} };
    const t0 = Date.now();
    const ok = await relocateFallback(bot, skills, solidRock, (s) => logs.push(s), 'no dry tunnel line');
    assert.equal(ok, false);
    assert.equal(bot.moved, 0, 'moveAway is useless underground');
    assert.ok(Date.now() - t0 < 1000);
    assert.match(logs.join('\n'), /honest fail/);
});

test('T-0193: a hung pathfinder walk is bounded and stopped', async () => {
    const bot = mkBot();
    const skills = { goToPosition: () => new Promise(() => {}) };
    const t0 = Date.now();
    const ok = await goToColumn(bot, skills, { x: 10, y: 48, z: 7 }, 150);
    assert.equal(ok, false);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(bot.stopped, 1);
});

test('T-0193: wiring — START relocate and the void branch both go through the bounded fallbacks', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /if \(!_ok\) _fbOk = await relocateFallback\(bot, skills, bn, log_, 'tunnel walk stopped'\);/);
    // live 00:35:52: arrived at the column but judged 'relocate failed (moved=5.1b footingOk=false)'
    assert.match(src, /if \(_fbOk\) \{ const _t0 = Date\.now\(\); while \(!bot\.entity\.onGround/);
    assert.match(src, /if \(movedB >= \(_fbOk \? 4 : 6\) && footingOk && clean2\) \{/);
    assert.match(src, /await relocateFallback\(bot, skills, bn, log_, 'no dry solid 9-cell tunnel line at this level'\);/);
    assert.match(src, /_moved = await relocateFallback\(bot, skills, bn, log_, `void, no tunnel line/);   // ★T-0193: surface & underground, ≤3 reachable candidates
    assert.doesNotMatch(src, /falling back to moveAway/);
});

// Live 10-10 01:23:48/57/59: 'path to solid column 22,36,-1 not reached' ×2 + '23,35,-3 not reached' — the nearest
// open-with-solid-floor column underground is often a sealed cave the pathfinder can't reach; one try then fail = 3 strikes.
test('T-0193: an unreachable column is skipped and the next candidate tried (≤3)', async () => {
    const { planSolidColumn } = await import('../bots/_supervisor/skills/mineDown.js');
    const k = (x, y, z) => `${x},${y},${z}`;
    const open = new Set();
    for (const [x, z] of [[2, 6], [2, 7], [9, 0]]) { open.add(k(x, 48, z)); open.add(k(x, 49, z)); }   // three candidate pockets
    const bn = (x, y, z) => open.has(k(x, y, z)) ? { name: 'cave_air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' };
    const first = planSolidColumn(bn, 0, 48, 0);
    const second = planSolidColumn(bn, 0, 48, 0, new Set([`${first.x},${first.z}`]));
    assert.notDeepEqual([second.x, second.z], [first.x, first.z]);
    const bot = mkBot();
    bot.entity.position = { x: 0.5, y: 48, z: 0.5 };
    const tried = [];
    const skills = { goToPosition: async (b, x, y, z) => { tried.push(`${x},${z}`); if (tried.length === 3) { b.entity.position = { x: x + 0.5, y, z: z + 0.5 }; } } };
    const ok = await relocateFallback(bot, skills, bn, () => {}, 'test');
    assert.equal(ok, true);
    assert.equal(new Set(tried).size, 3, `three distinct candidates: ${tried}`);
});
