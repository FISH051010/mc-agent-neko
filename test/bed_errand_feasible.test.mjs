import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { proposeTasks, bedErrandFeasible } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

// Live 10-10 00:17: naked respawn (1 wooden pick, 0 wood), no sheep/wool/string/sword → GET_BED@44 still
// proposed; once committed it held the body over REPLENISH_KIT@62 for 3 setBed "no sheep within 64 —
// defer" NO-OPs, re-armed every 5 min after the dispatch cooldown.
function makeBot(inv, ents = []) {
    const items = Object.entries(inv).map(([name, count]) => ({ name, count }));
    const entities = Object.fromEntries(ents.map(([name, x, z], i) => [i + 1, { name, position: new Vec3(x, 64, z) }]));
    return { inventory: { items: () => items, slots: [] }, game: { dimension: 'overworld' },
        entity: { position: new Vec3(0, 64, 0) }, entities, health: 20, food: 20 };
}
function dayWorld() {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { tod: 2000, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 1, pickTier: 'wooden' };
    return w;
}
const hasBed = (bot) => proposeTasks(dayWorld(), bot).some(p => p.kind === 'GET_BED');

test('T-0119: no sheep / wool / string / sword+spider → GET_BED is NOT proposed (setBed would only defer)', () => {
    assert.equal(bedErrandFeasible(makeBot({ wooden_pickaxe: 1 })), false);
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 })), false);
    // barehanded + spider: setBed skips the spider hunt without a sword
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 }, [['spider', 10, 0]])), false);
    // a sheep beyond setBed's 64b scan cannot be reached by it either
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 }, [['sheep', 80, 0]])), false);
});

test('T-0119: any real setBed path re-arms GET_BED', () => {
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 }, [['sheep', 55, 0]])), true, 'sheep within 64');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, white_wool: 3 })), true, 'wool in pack');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, red_bed: 1 })), true, 'bed in pack');
    // ★T-0220: GET_BED 只派 bedErrand — setBed 专属的 ≥4 线 / 蜘蛛取线路径 bedErrand 不走, 不再算可行 (否则提了必拒)
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, string: 4 })), false, 'T-0220: lone string no longer a path');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, iron_sword: 1 }, [['spider', 30, 0]])), false, 'T-0220: spider path dropped');
});

const hungry = (bot, food) => { bot.food = food; return bot; };

test('T-0119: setBed\'s hunger gates are mirrored — food<6 shrinks the sheep hunt to 12b and kills the spider hunt', () => {
    // live 10-10 01:42 food=0: 'setBed: no sheep within 12 (… fit=close-only) — defer' ×3 → dispatch-cooldown
    assert.equal(hasBed(hungry(makeBot({ wooden_pickaxe: 1, iron_sword: 1 }, [['sheep', 30, 0], ['spider', 20, 0]]), 0)), false);
    assert.equal(hasBed(hungry(makeBot({ wooden_pickaxe: 1 }, [['sheep', 10, 0]]), 0)), true, 'adjacent sheep is still hunted');
    assert.equal(hasBed(hungry(makeBot({ wooden_pickaxe: 1, iron_sword: 1 }, [['spider', 30, 0]]), 7)), false, 'spider 48b venture needs food>=8');
    assert.equal(hasBed(hungry(makeBot({ wooden_pickaxe: 1, white_wool: 3 }), 0)), true, 'wool in pack needs no hunt');
});

test('T-0178: 夜里 (timeOfDay 12800-23000) 有羊 → 不可行 (只在白天猎); 白天同场景可行 (T-0220: 蜘蛛路径已删, 改用羊)', () => {
    const night = makeBot({ stone_pickaxe: 2, stone_sword: 1 }, [['sheep', 20, 0]]);
    night.time = { timeOfDay: 16000 };
    assert.equal(bedErrandFeasible(night), false, 'night: no hunt');
    const day = makeBot({ stone_pickaxe: 2, stone_sword: 1 }, [['sheep', 20, 0]]);
    day.time = { timeOfDay: 4000 };
    assert.equal(bedErrandFeasible(day), true);
});

test('T-0178: 羊在 64 格内但 10 格内有僵尸 → 不可行 (setBed 有敌对就 defer); 包里有床/羊毛不受昼夜影响', () => {
    const mobbed = makeBot({ stone_sword: 1 }, [['sheep', 30, 0], ['zombie', 5, 0]]);
    mobbed.time = { timeOfDay: 4000 };
    assert.equal(bedErrandFeasible(mobbed), false);
    const woolNight = makeBot({ white_wool: 3 }); woolNight.time = { timeOfDay: 16000 };
    assert.equal(bedErrandFeasible(woolNight), true);
});

test('T-0178: 已承诺的 GET_BED 入夜即释放 (isGoalDone 与提案门同谓词)', async () => {
    const { isGoalDone } = await import('../src/agent/framework/world_model.js');
    const b = makeBot({ stone_sword: 1 }, [['sheep', 20, 0]]);
    b.time = { timeOfDay: 16000 };
    assert.equal(isGoalDone('GET_BED', dayWorld(), b), true);
    b.time = { timeOfDay: 4000 };
    assert.equal(isGoalDone('GET_BED', dayWorld(), b), false);
});
