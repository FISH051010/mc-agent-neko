// T-0229 盾牌第一 (监工战略拍板 2026-10-10): #13/#21/#22 三次骷髅死, bot 从没有盾; arrow_guard 早已装好 (每拍弹道预测 + 副手举盾)
// 只差一面盾。盾 = 1 铁锭 + 6 木板。① 第一块铁先造盾 (不吃给铁镐留的 3 铁) ② 造好即上副手 (slot 45)
// ③ 防护序 盾 > 胸 > 腿 > 铁剑 > 盔 > 靴 (armor_gate / craftArmor / 夜间 SMELT_IRON / world_model 同口径) ④ 先甲后钻: 胸甲档 + 盾才下深层。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.writeFileSync(path.join(home, 'bots', '_supervisor', 'keepinv.json'), JSON.stringify({ value: false }));
process.env.MC_AGENT_HOME = home;
process.chdir(home);
delete process.env.MC_FOOD_INSTINCTS;

const { nextProtectionPiece, diamondArmorReady, armorNightWarranted, hasShield, protectionHaveNames } = await import('../src/agent/framework/armor_gate.js');
const { armorCraftFeasible } = await import('../src/agent/framework/kit_gate.js');
const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { default: craftArmor } = await import('../bots/_supervisor/skills/craftArmor.js');

const fakeBot = (inv, { offhand = null, worn = [] } = {}) => {
    const slots = []; worn.forEach((n, i) => { slots[5 + i] = { name: n, count: 1 }; }); if (offhand) slots[45] = { name: offhand, count: 1 };
    return { inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })), slots },
        game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, health: 20, food: 20 };
};
const day = () => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true }; w.vitals = { ...w.vitals, armor: 0, hp: 20, food: 20 }; return w; };

test('T-0229: 防护序盾第一, 且不吃铁镐预留额 (shieldBudget); 副手/背包里有盾即视为已有', () => {
    assert.deepEqual(nextProtectionPiece([], 0, { shieldBudget: 1 }), ['shield', 1], '1 iron, all reserved for the pick → shield still first');
    assert.deepEqual(nextProtectionPiece(['shield'], 8), ['iron_chestplate', 8]);
    assert.equal(hasShield(fakeBot({}, { offhand: 'shield' })), true);
    assert.ok(protectionHaveNames(fakeBot({ iron_sword: 1 }, { offhand: 'shield', worn: ['iron_helmet'] })).includes('shield'));
});

test('T-0229: 盾另需 6 木板 — 1 原木 (4 板) 不够, 2 原木够; 台已带', () => {
    assert.equal(armorCraftFeasible({ iron_ingot: 1, crafting_table: 1, oak_log: 1 }, 1, { planksNeed: 6 }).ok, false);
    assert.equal(armorCraftFeasible({ iron_ingot: 1, crafting_table: 1, oak_log: 2 }, 1, { planksNeed: 6 }).ok, true);
    assert.equal(armorCraftFeasible({ iron_ingot: 1, crafting_table: 1, oak_planks: 6 }, 1, { planksNeed: 6 }).ok, true);
});

test('T-0229: 第一块铁 (无铁镐, 1 粗铁 + 木 + 煤 + 圆石) → 提 GET_ARMOR 造盾, 有盾后 1 铁不再提', () => {
    const inv = { raw_iron: 1, stone_pickaxe: 2, spruce_log: 4, coal: 3, cobblestone: 40 };
    const p = proposeTasks(day(), fakeBot(inv)).find(x => x.kind === 'GET_ARMOR');
    assert.ok(p && p.skill === 'craftArmor', 'shield errand proposed');
    assert.equal(isGoalDone('GET_ARMOR', day(), fakeBot(inv)), false);
    assert.equal(proposeTasks(day(), fakeBot({ ...inv, shield: 1 })).find(x => x.kind === 'GET_ARMOR'), undefined);
});

test('T-0229: 先甲后钻 — keepInventory 关时胸甲 + 盾才下深层; 夜间造甲判据含盾', () => {
    assert.equal(diamondArmorReady(['iron_chestplate'], true, { shield: false }), false);
    assert.equal(diamondArmorReady(['iron_chestplate'], true, { shield: true }), true);
    assert.equal(diamondArmorReady([], false, { shield: false }), true, 'keepInventory on → no gate');
    assert.equal(armorNightWarranted({ hasIronPick: true, hasTablePath: true, canSmeltHere: true, armorHave: ['iron_chestplate', 'iron_leggings', 'iron_sword', 'iron_helmet', 'iron_boots'], rawIron: 1, fuelUnits: 4 }), true, 'full iron set but no shield → still worth a night craft');
});

test('T-0229: craftArmor 1 粗铁 → 冶炼、补 6 木板、造盾、立即上副手; 返回真值 (甲件 0 也算进展)', async () => {
    const inv = { raw_iron: 1, spruce_log: 3, crafting_table: 1, coal: 2 };
    const bot = fakeBot(inv);
    const calls = [];
    const ctx = { log: () => {}, world: { getInventoryCounts: () => { const c = { ...inv }; if (bot.inventory.slots[45]) c[bot.inventory.slots[45].name] = 1; return c; } },
        skills: {
            customSkill: async (_b, name, ...args) => {
                calls.push([name, JSON.stringify(args)]);
                if (name === 'smeltSafe') { inv.raw_iron--; inv.iron_ingot = (inv.iron_ingot || 0) + 1; }
                if (name === 'craftChain') {
                    for (const [n, k] of args[0]) {
                        if (/_planks$/.test(n)) { inv.spruce_log -= k; inv.spruce_planks = (inv.spruce_planks || 0) + 4 * k; }
                        if (n === 'shield' && inv.iron_ingot >= 1 && (inv.spruce_planks || 0) >= 6) { inv.iron_ingot--; inv.spruce_planks -= 6; inv.shield = 1; }
                    }
                }
            },
            equip: async (_b, name) => { if (name === 'shield' && inv.shield) { delete inv.shield; bot.inventory.slots[45] = { name: 'shield', count: 1 }; } },
        } };
    const r = await craftArmor(bot, ctx, { order: 'protection' });
    assert.ok(r, `truthy progress (${r})`);
    const craft = calls.find(c => c[0] === 'craftChain');
    assert.match(craft[1], /spruce_planks/, 'planks queued before the shield');
    assert.match(craft[1], /shield/);
    assert.equal(bot.inventory.slots[45] && bot.inventory.slots[45].name, 'shield', 'shield in off-hand (arrow_guard reads slot 45)');
});

test('T-0229 补 (01:46:28Z 实录: craftChain iron_tier 镐+剑吃光 5 锭没盾): GET_IRON_TOOLS 没盾时清单 镐→盾→剑 且前置木板; 有盾不再造盾', async () => {
    const { ironTierRecipe } = await import('../src/agent/framework/world_model.js');
    const r = ironTierRecipe(fakeBot({ iron_ingot: 5, spruce_log: 14, spruce_planks: 2, stone_pickaxe: 2 }));
    const names = r.map(x => x[0]);
    assert.equal(names[0], 'spruce_planks', JSON.stringify(r));
    assert.ok(names.indexOf('shield') > names.indexOf('iron_pickaxe') && names.indexOf('shield') < names.indexOf('iron_sword'), JSON.stringify(names));
    const r2 = ironTierRecipe(fakeBot({ iron_ingot: 5, spruce_log: 14 }, { offhand: 'shield' }));
    assert.ok(!r2.some(x => x[0] === 'shield'), JSON.stringify(r2));
    const { proposeTasks } = await import('../src/agent/framework/world_model.js');
    const w = day();
    const p = proposeTasks(w, fakeBot({ iron_ingot: 5, spruce_log: 14, stone_pickaxe: 2, crafting_table: 1 })).find(x => x.kind === 'GET_IRON_TOOLS' && x.skill === 'craftChain');
    assert.ok(p && Array.isArray(p.args[0]) && p.args[0].some(x => x[0] === 'shield'), JSON.stringify(p && p.args));
});
