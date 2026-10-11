import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { settleForDig } from '../src/agent/framework/dig_settle.js';

// T-0283 (10-11 06:41:56-06:43:03Z): branchMine's coal_ore digs each ran the full 9s 'dig-timeout' (×3, ~27s lost; stone/wood
// pick on coal is 1.2-2.3s). mine_motion dig.begin had the body mid-drop (y=56.536 / 55.536 / 55.92) — branchMine had just
// dug the floor. mineflayer times a dig ONCE at start and ×5 when !onGround → wooden pick coal 2.25s → 11.25s > 9s.
const require = createRequire(import.meta.url);

test('T-0283: mineflayer really does time an airborne dig ×5 (why waiting to land fixes it)', () => {
    const src = fs.readFileSync(require.resolve('mineflayer/lib/plugins/digging.js'), 'utf8');
    assert.match(src, /!bot\.entity\.onGround/);
});

test('T-0283: settleForDig waits for the body to land (bounded) before a dig starts', async () => {
    const bot = { entity: { onGround: false } };
    setTimeout(() => { bot.entity.onGround = true; }, 120);
    const r = await settleForDig(bot, { maxMs: 1000, pollMs: 20 });
    assert.equal(r.grounded, true);
    assert.ok(r.waited >= 100 && r.waited < 600, `waited ${r.waited}ms`);
});

test('T-0283: grounded → no wait; never lands → gives up at maxMs; floating/climbing → no wait', async () => {
    assert.deepEqual(await settleForDig({ entity: { onGround: true } }), { waited: 0, grounded: true });
    const t0 = Date.now();
    const r = await settleForDig({ entity: { onGround: false } }, { maxMs: 150, pollMs: 20 });
    assert.equal(r.grounded, false);
    assert.ok(Date.now() - t0 < 500);
    assert.equal((await settleForDig({ entity: { onGround: false, isInWater: true } })).waited, 0);
    assert.equal((await settleForDig({ entity: { onGround: false, isOnLadder: true } })).waited, 0);
});

test('T-0283: every dig path lands first — branchMine digBlock, safeDig, breakBlockAt', () => {
    const bm = fs.readFileSync(new URL('../bots/_supervisor/skills/branchMine.js', import.meta.url), 'utf8');
    const i = bm.indexOf('const digBlock = async');
    const seg = bm.slice(i, bm.indexOf('bot.dig(fresh, true)', i));
    assert.match(seg, /await settleForDig\(bot\)/);
    // ★T-0280 in branchMine too: its failure path stops only its own dig
    assert.match(bm, /skills\.stopOwnDig\(bot, fresh\)/);
    const sk = fs.readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    const sd = sk.slice(sk.indexOf('export async function safeDig'));
    assert.ok(sd.indexOf('await settleForDig(bot)') < sd.indexOf('gazeHold(bot, cur, bot.dig(cur))'));
    const bb = sk.slice(sk.indexOf('export async function breakBlockAt'));
    assert.ok(bb.indexOf('await settleForDig(bot)') > 0 && bb.indexOf('await settleForDig(bot)') < bb.indexOf('bot.dig(block, true)'));
});
