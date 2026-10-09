// T-0151 先甲后钻 (监工拍板 10-10): 19:52Z 第三局铁镐刚造好, 无甲夜里直接 mineDiamonds 下深层, 背包 11 粗铁闲置;
// keepInventory=false → 无甲下深层是最贵的赌注。① 夜间冶炼在镐后继续造甲 (胸>腿>盔>靴, 造得起几件造几件);
// ② keepInventory=false 时钻石下潜要求护甲点≥8 或穿着胸甲, 不够则回落挖铁/造甲。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'armor-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.writeFileSync(path.join(home, 'bots', '_supervisor', 'keepinv.json'), JSON.stringify({ value: false }));
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { nextProtectionPiece, chestTierArmor, armorPoints, diamondArmorReady } = await import('../src/agent/framework/armor_gate.js');
const { PROTECTION_PIECES } = await import('../bots/_supervisor/skills/craftArmor.js');

const LIVE = { iron_pickaxe: 1, iron_sword: 1, stone_pickaxe: 2, raw_iron: 11, spruce_log: 11, cobblestone: 489, stick: 11 };   // 19:52 live
function fakeBot(inv, worn = []) {
    const slots = []; worn.forEach((n, i) => { slots[5 + i] = { name: n, count: 1 }; });
    return { inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots },
        game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 18, z: 0 } }, health: 20, food: 19 };
}
function nightWorld(decision) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'night', isDay: false };
    w.kit = { ...w.kit, picks: 3, pickTier: 'iron', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 20, food: 19, armor: 0 };
    w.nightPlan = { decision };
    return w;
}

test('T-0151: 防护优先序 — 11 铁先胸甲(8); 7 铁腿(7); 已有胸甲且只剩 3 铁 → 无可造', () => {
    assert.deepEqual(nextProtectionPiece([], 11), ['iron_chestplate', 8]);
    assert.deepEqual(nextProtectionPiece([], 7), ['iron_leggings', 7]);
    assert.equal(nextProtectionPiece(['iron_chestplate'], 3), null);
    assert.deepEqual(PROTECTION_PIECES('iron').map(p => p[0]), ['iron_chestplate', 'iron_leggings', 'iron_helmet', 'iron_boots']);
});

test('T-0151: 钻石甲门 — 胸甲或护甲点≥8; keepInventory=false 才生效', () => {
    assert.equal(chestTierArmor(['iron_chestplate']), true);
    assert.equal(armorPoints(['iron_helmet', 'iron_boots']), 4);
    assert.equal(chestTierArmor(['iron_helmet', 'iron_boots']), false);
    assert.equal(diamondArmorReady([], true), false);
    assert.equal(diamondArmorReady([], false), true, 'keepInventory on → no gate');
    assert.equal(diamondArmorReady([], null), true, 'unknown → no gate');
});

test('T-0151: 夜间 SMELT_IRON 在已有铁镐时改派 craftArmor(protection), 有造得起的下一件不释放', () => {
    const w = nightWorld('SMELT_IRON');
    const p = proposeTasks(w, fakeBot(LIVE)).find(x => x.kind === 'NIGHT_SMELT_IRON');
    assert.ok(p, 'proposed');
    assert.equal(p.skill, 'craftArmor');
    assert.equal(p.args[0].order, 'protection');
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, fakeBot(LIVE)), false, '11 iron, no chest → keep crafting');
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, fakeBot({ ...LIVE, raw_iron: 3 }, ['iron_chestplate'])), true, 'chest worn + 3 iron → nothing affordable → release');
});

test('T-0151: keepInventory=false 无胸甲 → 夜钻冲刺不派 mineDiamonds (回落挖铁); 穿胸甲后放行', () => {
    const w = nightWorld('MINE_THROUGH_NIGHT');
    const bare = proposeTasks(w, fakeBot(LIVE)).filter(x => x.kind === 'DUSK_MINE_NIGHT');
    assert.ok(bare.length && bare.every(x => x.skill !== 'mineDiamonds'), `bare: ${bare.map(x => x.skill)}`);
    const armored = proposeTasks(w, fakeBot(LIVE, ['iron_chestplate'])).filter(x => x.kind === 'DUSK_MINE_NIGHT');
    assert.ok(armored.some(x => x.skill === 'mineDiamonds'), `armored: ${armored.map(x => x.skill)}`);
});
