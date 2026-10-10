// T-0219 (2026-10-10 03:36:36Z): bedErrand 凑到混色 3 张羊毛 (单色最多 1 张 black) 判 materials ready → setBed 拒 ("床要 3 同色")
// → 秒败 ×3 → GET_BED 冷却 5min。决策层/bedErrand 必须与 setBed 同口径按单色算, 凑毛只打能补齐同一色的羊。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bed-wool-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.chdir(home);
process.env.MC_AGENT_HOME = home;
const { bedWoolReady, bestWoolColor, sheepColor, targetWoolColor, WOOL_COLORS } = await import('../src/agent/framework/bed_wool.js');
const { default: bedErrand, bedMaterialsReady } = await import('../bots/_supervisor/skills/bedErrand.js');
const { woolPathVisible } = await import('../src/agent/framework/world_model.js');

const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, offset(dx, dy, dz) { return V(this.x + dx, this.y + dy, this.z + dz); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
const sheep = (id, color, x) => ({ id, name: 'sheep', position: V(x, 66, 0), isValid: true, metadata: Object.assign([], { 17: WOOL_COLORS.indexOf(color) }) });

test('T-0219: 混色 3 张 (black/white/red 各 1) 不算床料; 同色 3 张或 2 白 + 4 线才算; 有床直接算', () => {
    assert.equal(bedWoolReady({ black_wool: 1, white_wool: 1, red_wool: 1 }), false);
    assert.equal(bedMaterialsReady({ black_wool: 1, white_wool: 1, red_wool: 1 }), false, 'bedErrand shares the same rule');
    assert.equal(bedWoolReady({ black_wool: 3 }), true);
    assert.equal(bedWoolReady({ white_wool: 2, string: 4 }), true);
    assert.equal(bedWoolReady({ black_wool: 2, string: 4 }), false, 'string folds into white only');
    assert.equal(bedWoolReady({ red_bed: 1 }), true);
    assert.deepEqual(bestWoolColor({ black_wool: 1, white_wool: 2 }), { color: 'white', ct: 2 });
});

test('T-0219: 羊颜色读元数据 17 (低 4 位, 0x10=已剪); 目标色 = 背包 + 附近头数最多', () => {
    assert.equal(sheepColor(sheep(1, 'black', 0)), 'black');
    assert.equal(sheepColor({ metadata: Object.assign([], { 17: 0x10 | 14 }) }), 'red');
    assert.equal(sheepColor({ metadata: [] }), null);
    assert.equal(targetWoolColor({ black_wool: 1 }, [sheep(1, 'white', 5), sheep(2, 'white', 6), sheep(4, 'white', 6), sheep(3, 'black', 7)]), 'white');
    assert.equal(targetWoolColor({ black_wool: 1 }, [sheep(1, 'white', 5), sheep(2, 'white', 6), sheep(3, 'black', 7)]), 'black', 'tie → the color already in the pack');
    assert.equal(targetWoolColor({ black_wool: 2 }, [sheep(1, 'white', 5), sheep(2, 'black', 7)]), 'black');
});

test('T-0219: 决策层 woolPathVisible 混色 3 张且附近无羊 → false (不提必拒的 GET_BED)', () => {
    const bot = { inventory: { items: () => [{ name: 'black_wool', count: 1 }, { name: 'white_wool', count: 1 }, { name: 'red_wool', count: 1 }], slots: [] },
        entity: { position: V(0, 66, 0) }, entities: {} };
    assert.equal(woolPathVisible(bot), false);
});

test('T-0219: bedErrand 背包 1 黑 1 白 1 红, 附近 2 黑 1 白羊 → 只杀 2 只黑羊凑 3 黑 → setBed (不在混色上交差)', async () => {
    const inv = { black_wool: 1, white_wool: 1, red_wool: 1 };
    const calls = [];
    const entities = { 1: sheep(1, 'white', 3), 2: sheep(2, 'black', 8), 3: sheep(3, 'black', 9) };
    const bot = { food: 14, health: 18, entity: { position: V(0, 66, 0) }, entities, blockAt: () => ({ name: 'air', skyLight: 15 }),
        inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
        pathfinder: { stop() {}, setGoal() {}, setMovements() {}, goto: async () => {} }, clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ ...inv }) },
        skills: { customSkill: async (_b, name) => { calls.push(name); return name === 'setBed'; },
                  attackEntity: async (_b, s) => { const c = sheepColor(s); calls.push(`attack:${c}`); inv[`${c}_wool`] = (inv[`${c}_wool`] || 0) + 1; for (const k of Object.keys(entities)) if (entities[k] === s) delete entities[k]; },
                  pickupNearbyItems: async () => {}, equip: async () => {} } };
    const r = await bedErrand(bot, ctx);
    assert.equal(r, true, JSON.stringify(r));
    assert.deepEqual(calls, ['attack:black', 'attack:black', 'setBed']);
});
