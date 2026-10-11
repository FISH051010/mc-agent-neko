// T-0253 (2026-10-11 03:49-03:50Z): 熔完 15 块造胸甲/腿甲后只剩 1 粗铁 (铁镐 03:16 死亡掉了), 承诺仍拿旧参数 smeltSafe(raw_iron,5);
// smeltItem 要求持有≥num → 'not enough' 一块不熔; NIGHT_SMELT_IRON 完成判据要粗铁清零才放手 → 空转 ×3 冷却。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nsnoop-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
const { default: smeltSafe } = await import('../bots/_supervisor/skills/smeltSafe.js');
const { isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

test('T-0253: smeltSafe 请求数 > 持有数 → 按持有数熔 (不再 smeltItem not-enough 一块不熔)', async () => {
    const FURNACE = { name: 'furnace', position: { x: 0, y: 64, z: 0 } };
    const inv = { raw_iron: 1, coal: 19, cobblestone: 300 };
    const asked = [];
    const bot = { entity: { position: { x: 1, y: 64, z: 0, offset() { return this; } } }, blockAt: () => FURNACE };
    const ctx = { log: () => {}, world: { getNearestBlock: () => FURNACE, getInventoryCounts: () => ({ ...inv }) },
        skills: { smeltItem: async (_b, item, n) => { asked.push(n); if ((inv[item] || 0) < n) return false; inv[item] -= n; inv.iron_ingot = (inv.iron_ingot || 0) + n; return true; },
                  clearNearestFurnace: async () => true, collectBlock: async () => true, goToPosition: async () => {} } };
    const r = await smeltSafe(bot, ctx, 'raw_iron', 5);
    assert.deepEqual(asked, [1], 'clamped to what is held');
    assert.equal(r, true);
    assert.equal(inv.iron_ingot, 1);
});

test('T-0253: 无铁镐时 NIGHT_SMELT_IRON 完成判据 — 锭+粗铁凑不够 3 也放手 (同提案门); 够 3 继续', () => {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.kit = { ...w.kit, picks: 2, pickTier: 'stone' };
    const bot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] } });
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot({ raw_iron: 1, coal: 19 })), true, '1 raw iron cannot become a pick');
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot({ raw_iron: 2, iron_ingot: 1, coal: 19 })), false, '2 raw + 1 ingot = 3 → keep smelting');
});

test('T-0266: 熔铁烧光木头无台路 (kit.hasTablePath=false) → NIGHT_SMELT_IRON 放手, 不再粘着派 craftArmor/craftChain 必拒', () => {
    const bot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] } });
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.kit = { ...w.kit, picks: 4, pickTier: 'iron', hasTablePath: false };
    const rich = { iron_ingot: 9, iron_pickaxe: 1, iron_sword: 1, shield: 1, cobblestone: 171 };   // 胸甲造得起, 但没台
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot(rich)), true, 'no table path: release');
    w.kit.hasTablePath = true;
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot(rich)), false, 'table path + chest affordable → keep');
    // 无铁镐: 无台路但还有粗铁可熔 → 继续熔 (熔炉不要台); 粗铁熔完 → 放手
    const s = JSON.parse(JSON.stringify(EMPTY_WORLD)); s.kit = { ...s.kit, picks: 2, pickTier: 'stone', hasTablePath: false };
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', s, bot({ raw_iron: 3, coal: 4 })), false);
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', s, bot({ iron_ingot: 3, coal: 4 })), true);
});

test('T-0266 (监工拍板): 严格防护序 — 盾在 + 5 锭 + 0 粗铁: 胸甲要 8 造不起 = 攒锭, 不跳去造头盔; 夜里不提 NIGHT_SMELT_IRON, 承诺放手', async () => {
    const { nextProtectionPiece, missingProtectionPiece, armorNightWarranted } = await import('../src/agent/framework/armor_gate.js');
    const have = ['shield', 'iron_sword'];
    assert.equal(nextProtectionPiece(have, 5, { withSword: true }), null, 'saving for the chestplate');
    assert.deepEqual(missingProtectionPiece(have, { withSword: true }), ['iron_chestplate', 8]);
    assert.deepEqual(nextProtectionPiece(have, 8, { withSword: true }), ['iron_chestplate', 8]);
    assert.deepEqual(nextProtectionPiece([...have, 'iron_chestplate', 'iron_leggings'], 5, { withSword: true }), ['iron_helmet', 5], 'chest+legs done → helmet next');
    assert.equal(armorNightWarranted({ hasIronPick: true, hasTablePath: true, canSmeltHere: true, armorHave: have, rawIron: 0, ingots: 5, fuelUnits: 4 }), false, 'night plan: no SMELT_IRON');
    const bot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] } });
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.kit = { ...w.kit, picks: 4, pickTier: 'iron', hasTablePath: true };
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot({ iron_ingot: 5, iron_pickaxe: 1, iron_sword: 1, shield: 1, crafting_table: 1, coal: 8 })), true, 'commitment releases while saving');
});

test('T-0266 (监工): craftArmor 下一件锭不够 → 非失败 {ok, saving, need, have} + 写 progress, 不造头盔', async () => {
    const { default: craftArmor } = await import('../bots/_supervisor/skills/craftArmor.js');
    const inv = { iron_ingot: 5, iron_pickaxe: 1, iron_sword: 1, crafting_table: 1, coal: 8 };
    const bot = { inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })), slots: { 45: { name: 'shield', count: 1 } } }, health: 20 };
    const calls = [];
    const ctx = { log: () => {}, world: { getInventoryCounts: () => ({ ...inv, shield: 1 }) },
        skills: { customSkill: async (_b, n, ...a) => { calls.push(n + JSON.stringify(a)); }, equip: async () => {} } };
    const r = await craftArmor(bot, ctx, { order: 'protection' });
    assert.deepEqual(r, { ok: true, saving: 'iron_chestplate', need: 8, have: 5 });
    assert.ok(!calls.some(c => /craftChain/.test(c)), 'no helmet crafted: ' + calls);
    assert.match(fs.readFileSync(path.join(home, 'bots', '_supervisor', 'progress.txt'), 'utf8'), /saving iron for iron_chestplate \(5\/8\)/);
});

test('T-0266 补 (监工): smeltSafe 烧木当燃料时留拍台+折棍的原木 (与提案侧 smeltableUnits 同一函数); 煤够照熔; 煮肉不扣', async () => {
    const { smeltableUnits } = await import('../src/agent/framework/kit_gate.js');
    const FURNACE = { name: 'furnace', position: { x: 0, y: 64, z: 0 } };
    const run = async (inv, item = 'raw_iron', n = 5) => {
        const asked = [];
        const bot = { entity: { position: { x: 1, y: 64, z: 0, offset() { return this; } } }, blockAt: () => FURNACE };
        const ctx = { log: () => {}, world: { getNearestBlock: () => FURNACE, getInventoryCounts: () => ({ ...inv }) },
            skills: { smeltItem: async (_b, it, k) => { asked.push(k); inv[it] -= k; return true; },
                      clearNearestFurnace: async () => true, collectBlock: async () => true, goToPosition: async () => {} } };
        const r = await smeltSafe(bot, ctx, item, n);
        return { asked, r, proposalSide: smeltableUnits(inv) };
    };
    // 3 原木 0 煤 5 粗铁: 烧 1 根 (1 块), 留 2 根 = 拍台 4 板 + 折棍
    assert.deepEqual((await run({ spruce_log: 3, raw_iron: 5 })).asked, [1]);
    // 2 原木 0 煤: 一块不熔 (提案侧 smeltableUnits 同为 0, 不会提)
    const z = await run({ spruce_log: 2, raw_iron: 5 });
    assert.deepEqual(z.asked, []); assert.equal(z.r, false); assert.equal(smeltableUnits({ spruce_log: 2 }), 0, 'same budget on the proposal side');
    assert.deepEqual((await run({ coal: 1, spruce_log: 2, raw_iron: 5 })).asked, [5], 'coal covers it');
    assert.deepEqual((await run({ spruce_log: 2, beef: 3 }, 'beef', 3)).asked, [3], 'cooking food keeps the old behaviour');
});

test('T-0287: 养伤锁存成立 (hp<10) → 夜间熔铁/造甲承诺放手且不再提 (会动身体: 放炉挖格/收台走路), 夜链回落原地封坑', async () => {
    const { proposeTasks } = await import('../src/agent/framework/world_model.js');
    const { HEAL_RISKY_KINDS } = await import('../src/agent/framework/food_floor.js');
    assert.ok(HEAL_RISKY_KINDS.has('NIGHT_SMELT_IRON'));
    const bot = (inv, extra = {}) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
        game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 20, z: 0 } }, entities: {}, health: 20, food: 20, ...extra });
    const inv = { iron_ingot: 9, iron_pickaxe: 1, iron_sword: 1, shield: 1, crafting_table: 1, coal: 8, cobblestone: 64 };
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'night', isDay: false }; w.kit = { ...w.kit, picks: 3, pickTier: 'iron', hasTablePath: true };
    w.nightPlan = { decision: 'SMELT_IRON' };
    w.vitals = { ...w.vitals, hp: 20, food: 20 };
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot(inv)), false, 'healthy: chestplate affordable → keep');
    assert.ok(proposeTasks(w, bot(inv)).some(p => p.kind === 'NIGHT_SMELT_IRON'));
    // 07:06:46Z: 坠落后 hp 1 → 下一拍锁存成立
    w.vitals = { ...w.vitals, hp: 1 };
    const hurt = bot(inv);
    const ps = proposeTasks(w, hurt);
    assert.equal(hurt._healLatch, true, 'heal latch engaged at hp 1');
    assert.ok(!ps.some(p => p.kind === 'NIGHT_SMELT_IRON'), JSON.stringify(ps.map(p => p.kind)));
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, hurt), true, 'committed night smelt released → kernel interrupts the moving child');
});
