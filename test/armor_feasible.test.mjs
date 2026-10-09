// T-0157 (监工加急 10-10): 19:57:04→20:00:06 GET_ARMOR→craftArmor ×3 秒败 → 5min 冷却。背包 11 粗铁, 但 0 原木/0 煤/无台
// → smeltSafe "no carried/nearby table and no wood to make one"; 后来 4 木板也只够拍台 → consumed=0。
// 铁律 2: 决策层不能提技能层必拒的 craftArmor。另: hp<10 / food≤6 时甲让位。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'armor-feas-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.writeFileSync(path.join(home, 'bots', '_supervisor', 'keepinv.json'), JSON.stringify({ value: false }));
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { armorCraftFeasible } = await import('../src/agent/framework/kit_gate.js');

// 19:57-19:59 live (节选): 铁镐+铁剑, 11 粗铁, 0 煤, 0 原木, 无台
const LIVE = { iron_pickaxe: 1, iron_sword: 1, stone_pickaxe: 2, raw_iron: 11, cobblestone: 489, stick: 11, rotten_flesh: 2 };
const fakeBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, health: 20, food: 18 });
function dayWorld({ hp = 20, food = 18 } = {}) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 3, pickTier: 'iron', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp, food, armor: 0 };
    return w;
}
const armorProps = (w, inv) => proposeTasks(w, fakeBot(inv)).filter(p => p.kind === 'GET_ARMOR');

test('T-0157: armorCraftFeasible — 无木无台 → no-table; 4 木板拍完台没燃料 → no-fuel; 有煤/原木 → ok', () => {
    assert.equal(armorCraftFeasible(LIVE, 8).why, 'no-table');
    assert.match(armorCraftFeasible({ ...LIVE, spruce_planks: 4 }, 8).why, /^no-fuel/);
    assert.equal(armorCraftFeasible({ ...LIVE, coal: 1 }, 8, { tableNear: true }).ok, true);
    assert.equal(armorCraftFeasible({ ...LIVE, spruce_log: 7 }, 8).ok, true, '1 log → table, 6 logs ×1.5 = 9 ≥ 8');
    assert.equal(armorCraftFeasible({ ...LIVE, iron_ingot: 8, raw_iron: 0, crafting_table: 1 }, 8).ok, true, '锭够不用炉不用燃料');
    assert.equal(armorCraftFeasible({ ...LIVE, coal: 2, crafting_table: 1, cobblestone: 3 }, 8).why, 'no-furnace');
});

test('T-0157: 19:57 实录 (0 木 0 煤 无台) → 不提 GET_ARMOR, 粘着的 GET_ARMOR 释放; 有料则提', () => {
    assert.equal(armorProps(dayWorld(), LIVE).length, 0, 'skill would refuse → must not propose');
    assert.equal(isGoalDone('GET_ARMOR', dayWorld(), fakeBot(LIVE)), true, 'release the stuck commitment');
    const ok = { ...LIVE, spruce_log: 11, coal: 2 };
    assert.equal(armorProps(dayWorld(), ok).length, 1);
    assert.equal(isGoalDone('GET_ARMOR', dayWorld(), fakeBot(ok)), false);
});

test('T-0157: hp<10 或 food≤6 → GET_ARMOR 让位 (先吃/回血)', () => {
    const ok = { ...LIVE, spruce_log: 11, coal: 2 };
    assert.equal(armorProps(dayWorld({ hp: 8 }), ok).length, 0);
    assert.equal(armorProps(dayWorld({ food: 6 }), ok).length, 0);
    assert.equal(armorProps(dayWorld({ hp: 12, food: 12 }), ok).length, 1);
});
