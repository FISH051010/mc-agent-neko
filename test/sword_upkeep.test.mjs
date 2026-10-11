// T-0170 (监工指派): death #8 21:17:59Z — 铁镐在手却无剑, self_defense 只认剑/斧不出手, 被僵尸三下打死。
// 补给不变量加 swords≥1: 有圆石就造石剑 (2 圆石 + 1 棍, 镐优先); 有铁镐后防护序 胸 > 腿 > 铁剑 > 盔 > 靴。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sword-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { toolUpkeepPlan, needsToolUpkeep } = await import('../src/agent/framework/kit_gate.js');
const { nextProtectionPiece } = await import('../src/agent/framework/armor_gate.js');
const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { PROTECTION_PIECES_WITH_SWORD } = await import('../bots/_supervisor/skills/craftArmor.js');

// 21:13Z live (death #8 前): 铁镐 + 石镐, 462 圆石, 6 棍, 台, 15 原木, 无剑
const LIVE = { iron_pickaxe: 1, stone_pickaxe: 1, wooden_pickaxe: 1, cobblestone: 462, stick: 6, crafting_table: 1, spruce_log: 8, birch_log: 7, coal: 21 };
const woodUnits = (c) => Object.keys(c).filter(k => k.endsWith('_log')).reduce((s, k) => s + c[k] * 4, 0) + Object.keys(c).filter(k => k.endsWith('_planks')).reduce((s, k) => s + c[k], 0);
const has = (wants, n) => wants.some(([x]) => x === n);

test('T-0170: 铁镐在手无剑 + 圆石 → 需维护且计划含石剑', () => {
    assert.equal(needsToolUpkeep({ sufficientForUnderground: true, pickTier: 'iron', counts: LIVE }), true);
    const { wants } = toolUpkeepPlan({ picks: 3, pickTier: 'iron', counts: LIVE, woodUnits: woodUnits(LIVE) });
    assert.ok(has(wants, 'stone_sword'), JSON.stringify(wants));
    const armed = { ...LIVE, iron_sword: 1 };
    assert.equal(needsToolUpkeep({ sufficientForUnderground: true, pickTier: 'iron', counts: armed }), false, 'has a sword → no upkeep');
});

test('T-0170: 死后重开局 — 首批圆石: 3 块只够镐 (镐优先), 5 块镐+剑', () => {
    const base = { wooden_pickaxe: 1, stick: 4, crafting_table: 1, oak_log: 3 };
    const p3 = toolUpkeepPlan({ picks: 1, pickTier: 'wood', counts: { ...base, cobblestone: 3 }, woodUnits: 12 }).wants;
    assert.ok(has(p3, 'stone_pickaxe') && !has(p3, 'stone_sword'), JSON.stringify(p3));
    const p5 = toolUpkeepPlan({ picks: 1, pickTier: 'wood', counts: { ...base, cobblestone: 5 }, woodUnits: 12 }).wants;
    assert.ok(has(p5, 'stone_pickaxe') && has(p5, 'stone_sword'), JSON.stringify(p5));
});

test('T-0170: 决策层 — live 状态提 TOOL_UPKEEP 且清单含石剑', () => {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 3, pickTier: 'iron', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 14, food: 14 };
    const bot = { inventory: { items: () => Object.entries(LIVE).map(([name, count]) => ({ name, count })), slots: [] },
        game: { dimension: 'overworld' }, entity: { position: { x: 12, y: 51, z: 46 } }, health: 14, food: 14 };
    const p = proposeTasks(w, bot).find(x => x.kind === 'TOOL_UPKEEP');
    assert.ok(p && has(p.args[0], 'stone_sword'), JSON.stringify(p && p.args));
});

test('T-0170: 防护序含铁剑 — 胸 > 腿 > 铁剑 > 盔 > 靴; 已有铁剑跳过; 不带 withSword 时序不变', () => {
    // ★T-0229: 盾排在最前 (盾 > 胸 > 腿 > 铁剑 > 盔 > 靴); 以下"已有"名单都带盾, 验铁剑的相对位置不变
    assert.deepEqual(nextProtectionPiece([], 11, { withSword: true }), ['shield', 1]);
    assert.deepEqual(nextProtectionPiece(['shield'], 11, { withSword: true }), ['iron_chestplate', 8]);
    assert.deepEqual(nextProtectionPiece(['shield', 'iron_chestplate', 'iron_leggings', 'stone_sword'], 3, { withSword: true }), ['iron_sword', 2]);
    assert.deepEqual(nextProtectionPiece(['shield', 'iron_chestplate', 'iron_leggings', 'iron_sword'], 5, { withSword: true }), ['iron_helmet', 5]);
    assert.equal(nextProtectionPiece(['shield', 'iron_chestplate', 'iron_leggings'], 3), null, 'legacy order unchanged');
    assert.deepEqual(PROTECTION_PIECES_WITH_SWORD.map(p => p[0]), ['shield', 'iron_chestplate', 'iron_leggings', 'iron_sword', 'iron_helmet', 'iron_boots']);
});
