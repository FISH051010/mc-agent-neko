import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { createRequire } from 'node:module';
import { breakBlockAt, safeDig } from '../src/agent/library/skills.js';

// pick-tier ore gate (2026-07-14, 用户: "偶发性用石镐挖钻石"): breaking an ore with a pick below its
// harvest tier drops NOTHING — the ore is gone forever. Every dig path only checked "is there a pick",
// never "can this pick HARVEST it". Real 1.21.1 block data: the harvest table + digTime are authoritative
// (wooden pick × diamond_ore = 7500ms < breakBlockAt's 9s escape-dig allowance = the live leak).

const require = createRequire(import.meta.url);
const VERSION = '1.21.1';
const mcData = require('minecraft-data')(VERSION);
const Block = require('prismarine-block')(VERSION);

const AT = new Vec3(1, 64, 0);
function realBlock(name) {
    const b = Block.fromStateId(mcData.blocksByName[name].defaultState, 0);
    b.position = AT.clone();
    return b;
}
const item = (name) => ({ name, type: mcData.itemsByName[name].id, count: 1 });

function makeBot({ held, blockName, inv = [] }) {
    const calls = { dig: 0 };
    const world = new Map([[AT.toString(), realBlock(blockName)]]);
    const air = (p) => ({ name: 'air', boundingBox: 'empty', position: p, type: 0 });
    const bot = {
        entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, isInWater: false },
        game: { gameMode: 'survival', dimension: 'overworld' },
        heldItem: held ? item(held) : null,
        inventory: { items: () => [...(held ? [item(held)] : []), ...inv.map(item)], slots: [] },
        modes: { isOn: () => false },
        interrupt_code: false,
        output: '',
        oxygenLevel: 20,
        blockAt: (p) => world.get(new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)).toString()) || air(p),
        tool: { equipForBlock: async () => {} },
        equip: async () => {},
        lookAt: async () => {},
        canSeeBlock: () => true,
        clearControlStates() {},
        setControlState() {},
        dig: async (b) => { calls.dig++; world.delete(b.position.toString()); },
        stopDigging() {},
        on() {}, once() {}, removeListener() {}, off() {},
    };
    return { bot, calls, world };
}

test('pick-tier: real 1.21.1 harvest table — the gate criterion is canHarvest, not names/digTime', () => {
    const d = realBlock('diamond_ore');
    assert.ok(!d.canHarvest(item('stone_pickaxe').type));   // prismarine-block returns undefined, not false
    assert.ok(!d.canHarvest(item('wooden_pickaxe').type));
    assert.ok(d.canHarvest(item('iron_pickaxe').type));
    assert.ok(d.digTime(item('wooden_pickaxe').type, false, false, false) < 9000, 'wooden×diamond slips under the 9s escape-dig cap');
    assert.ok(realBlock('nether_gold_ore').canHarvest(item('wooden_pickaxe').type), 'name regex /gold_ore/ would wrongly refuse this');
});

test('pick-tier (breakBlockAt PRIMARY): wooden/stone pick never breaks diamond ore — clean false, ore survives', async () => {
    for (const held of ['wooden_pickaxe', 'stone_pickaxe']) {
        const { bot, calls, world } = makeBot({ held, blockName: 'diamond_ore' });
        const r = await breakBlockAt(bot, AT.x, AT.y, AT.z);
        assert.equal(r, false, held);
        assert.equal(calls.dig, 0, `${held} must not dig diamond_ore`);
        assert.equal(world.get(AT.toString()).name, 'diamond_ore');
    }
    const { bot, calls } = makeBot({ held: 'wooden_pickaxe', blockName: 'iron_ore' });
    assert.equal(await breakBlockAt(bot, AT.x, AT.y, AT.z), false, 'iron_ore needs stone+');
    assert.equal(calls.dig, 0);
});

test('pick-tier (breakBlockAt): escape digging of non-ore stone with a sub-tier/no tool is still allowed', async () => {
    // stone bare-hand = 7500ms (<9s cap). NB on 1.21.1 bare-hand cobblestone is 10000ms > 9s, so it is refused.
    const { bot, calls } = makeBot({ held: null, blockName: 'stone' });
    await breakBlockAt(bot, AT.x, AT.y, AT.z).catch(() => {});
    assert.equal(calls.dig, 1, 'bare-hand stone break un-traps a pickless bot (anti-石棺)');
    const ok = makeBot({ held: 'iron_pickaxe', blockName: 'diamond_ore' });
    await breakBlockAt(ok.bot, AT.x, AT.y, AT.z).catch(() => {});
    assert.equal(ok.calls.dig, 1, 'iron pick harvests diamond normally');
});

test('pick-tier (safeDig): sub-tier held pick on an ore → "wrong-tool", no dig (protects harvestConnectedVein)', async () => {
    const old = process.env.MC_DIG_FLUID_GUARD;
    process.env.MC_DIG_FLUID_GUARD = '0';
    try {
        const { bot, calls, world } = makeBot({ held: 'stone_pickaxe', blockName: 'deepslate_diamond_ore' });
        const r = await safeDig(bot, world.get(AT.toString()), { approach: false, equip: false, maxMs: 2000 });
        assert.equal(r, 'wrong-tool');
        assert.equal(calls.dig, 0);
    } finally {
        if (old === undefined) delete process.env.MC_DIG_FLUID_GUARD; else process.env.MC_DIG_FLUID_GUARD = old;
    }
});
