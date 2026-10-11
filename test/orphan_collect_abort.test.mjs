import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Vec3 from 'vec3';
import { stopOwnDig, safeDig, collectBlockWithin, reclaimTableAt } from '../src/agent/library/skills.js';

// T-0280 (10-11 06:40:37-06:41:03Z, GO_UNDERGROUND 3 连败冷却): craftChain's table reclaim raced
// skills.collectBlock(bot,'crafting_table',1) against a 15s timeout and returned on the timeout — the collectBlock kept
// running detached: it pathed 40 blocks to ANOTHER table (act_trace 06:40:41-06:41:00 path=1 while mineDown ran) and
// its safeDig dug over mineDown's digs. Each time its own dig was replaced, safeDig's catch called bot.stopDigging() —
// which stops WHATEVER dig is current: mineDown's ('abortBy=safeDig (skills.js:1558) < collectBlock' ×2).
process.env.MC_DIG_FLUID_GUARD = '0';
const at = (x, y, z, name = 'stone') => ({ name, position: new Vec3(x, y, z), boundingBox: 'block', canHarvest: () => true, digTime: () => 100 });

test('T-0280: stopOwnDig stops only the dig on THIS block', () => {
    let stopped = 0;
    const bot = { targetDigBlock: at(1, 2, 3), stopDigging() { stopped++; } };
    assert.equal(stopOwnDig(bot, at(9, 9, 9)), false, 'someone else\'s dig is left alone');
    assert.equal(stopped, 0);
    assert.equal(stopOwnDig(bot, at(1, 2, 3)), true);
    assert.equal(stopped, 1);
    bot.targetDigBlock = null;
    assert.equal(stopOwnDig(bot, at(1, 2, 3)), false, 'nothing digging → nothing to stop');
    assert.equal(stopped, 1);
});

function digBot(blocks) {
    const bot = {
        entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, isInWater: false },
        game: { gameMode: 'survival' }, heldItem: null, interrupt_code: false, stopped: 0,
        blockAt: (p) => blocks.get(`${p.x},${p.y},${p.z}`) || { name: 'air', position: p, boundingBox: 'empty' },
        stopDigging() { this.stopped++; this.targetDigBlock = null; },
        lookAt: async () => {},
    };
    return bot;
}

test('T-0280: safeDig whose dig was replaced by another digger does NOT stop that other dig', async () => {
    const mine = at(1, 64, 0), theirs = at(0, 63, 1, 'dirt');
    const bot = digBot(new Map([['1,64,0', mine]]));
    bot.dig = async () => { bot.targetDigBlock = theirs; throw new Error('Digging aborted'); };   // mineDown's bot.dig took over
    const r = await safeDig(bot, mine, { approach: false, equip: false });
    assert.equal(r, 'error');
    assert.equal(bot.stopped, 0, 'mineDown\'s dig survives');
});

test('T-0280: safeDig honours an abort signal (bounded collect) and stops its OWN dig', async () => {
    const mine = at(1, 64, 0);
    const bot = digBot(new Map([['1,64,0', mine]]));
    const signal = { aborted: false };
    // a dig the server never acknowledges; like mineflayer, stopDigging rejects it
    bot.dig = () => { bot.targetDigBlock = mine; return new Promise((_, rej) => { bot.stopDigging = function () { this.stopped++; this.targetDigBlock = null; rej(new Error('Digging aborted')); }; }); };
    setTimeout(() => { signal.aborted = true; }, 50);
    const t0 = Date.now();
    const r = await safeDig(bot, mine, { approach: false, equip: false, signal });
    assert.equal(r, 'error');
    assert.ok(Date.now() - t0 < 1000, 'aborts within the 200ms poll, not the 8s dig timeout');
    assert.equal(bot.stopped, 1);
});

test('T-0280: collectBlockWithin — on timeout the collect is cancelled and has SETTLED before it returns (no orphan)', async () => {
    let goalNulled = 0, settled = false, sawSignal = null;
    const bot = { pathfinder: { setGoal(g) { if (g === null) goalNulled++; } } };
    const collect = async (b, type, num, exclude, vein, { signal }) => {
        sawSignal = signal;
        while (!signal.aborted) await new Promise(r => setTimeout(r, 20));
        settled = true;
        return 0;
    };
    await assert.rejects(collectBlockWithin(bot, 'crafting_table', 1, { maxMs: 60, collect }), /collect-timeout/);
    assert.equal(sawSignal.aborted, true);
    assert.equal(settled, true, 'the inner collect finished before the caller moved on');
    assert.equal(goalNulled, 1, 'its in-flight walk is halted');
});

test('T-0280: collectBlockWithin passes a normal result straight through', async () => {
    const r = await collectBlockWithin({}, 'oak_log', 2, { maxMs: 1000, collect: async () => 2 });
    assert.equal(r, 2);
});

test('T-0280: collectBlockWithin — an external abort (stall detector) cancels it the same way', async () => {
    let settled = false;
    const collect = async (b, t, n, e, v, { signal }) => { while (!signal.aborted) await new Promise(r => setTimeout(r, 20)); settled = true; };
    const abortOn = new Promise((_, rej) => setTimeout(() => rej(new Error('chop-collect-stall')), 40));
    await assert.rejects(collectBlockWithin({ pathfinder: { setGoal() {} } }, 'oak_log', 1, { maxMs: 5000, collect, abortOn }), /chop-collect-stall/);
    assert.equal(settled, true);
});

test('T-0280: reclaimTableAt breaks THE placed table only — never goes looking for another one', async () => {
    const pos = new Vec3(2, 64, 0);
    const blocks = new Map([['2,64,0', at(2, 64, 0, 'crafting_table')]]);
    const bot = digBot(blocks);
    const broke = [];
    const breakAt = async (b, x, y, z) => { broke.push([x, y, z]); blocks.delete(`${x},${y},${z}`); return true; };
    const pickup = async () => true;
    assert.deepEqual(await reclaimTableAt(bot, pos, { breakAt, pickup }), { reclaimed: true });
    assert.deepEqual(broke, [[2, 64, 0]]);
    // out of reach → leave it (no walk, no dig)
    blocks.set('9,64,0', at(9, 64, 0, 'crafting_table'));
    const r2 = await reclaimTableAt(bot, new Vec3(9, 64, 0), { breakAt, pickup });
    assert.equal(r2.reclaimed, false);
    assert.equal(r2.reason, 'out-of-reach');
    // gone (already broken / never placed)
    const r3 = await reclaimTableAt(bot, new Vec3(5, 64, 5), { breakAt, pickup });
    assert.equal(r3.reason, 'gone');
    assert.equal(broke.length, 1);
});

test('T-0280: callers — no table reclaim by collectBlock type search; raced collects go through the bounded wrapper', () => {
    const cc = fs.readFileSync(new URL('../bots/_supervisor/skills/craftChain.js', import.meta.url), 'utf8');
    const ac = fs.readFileSync(new URL('../bots/_supervisor/skills/achieve.js', import.meta.url), 'utf8');
    const cw = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    const sk = fs.readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    for (const src of [cc, ac]) {
        assert.doesNotMatch(src, /collectBlock\(bot, 'crafting_table', 1\)/);
        assert.match(src, /skills\.reclaimTableAt\(bot, /);
    }
    assert.match(ac, /skills\.collectBlockWithin\(bot, block, wantBlocks, \{ maxMs: 25000/);
    assert.match(cw, /skills\.collectBlockWithin\(bot, nearest\.t, 1, \{ maxMs: 45000, exclude: _cbExclude, veinFollow: true, abortOn: _cbStall/);
    // collectBlock's loop and every safeDig in it honour the signal
    assert.match(sk, /for \(let i=0; i<maxAttempts && collected < num && !_cbAborted\(\); i\+\+\) \{/);
    assert.equal((sk.match(/await safeDig\(bot, (_raw|block), \{[^}]*signal: _cbSignal/g) || []).length, 3);
    // every failure path of safeDig / breakBlockAt stops only its own dig
    const sd = sk.slice(sk.indexOf('export async function safeDig'), sk.indexOf('export async function safeDig') + 16000);
    assert.doesNotMatch(sd.slice(sd.indexOf("return 'ok';"), sd.indexOf("return 'ok';") + 300), /bot\.stopDigging\(\)/);
});
