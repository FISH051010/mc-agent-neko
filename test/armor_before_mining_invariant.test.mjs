// T-0192 (death #12 23:55:25Z): 一夜挖到 29 粗铁仍 0 甲, 被僵尸打死。夜间造甲 NIGHT_SMELT_IRON 与已承诺的 DUSK_MINE_NIGHT 同 @94,
// 夜计划抢占要严格更高 → 承诺钉在挖矿上。监工要的不变量: keepInventory=false + 护甲点 <8 + 包里铁 (粗铁+锭) 够做胸甲 →
// 夜计划必须选冶炼造甲 (不能选挖矿), 且提案能从已承诺的夜挖手里抢下身体。以后谁调优先级都不能把它压回去。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'armor-inv-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.writeFileSync(path.join(home, 'bots', '_supervisor', 'keepinv.json'), JSON.stringify({ value: false }));
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { armorNightWarranted, armorPoints } = await import('../src/agent/framework/armor_gate.js');
const { proposeTasks, commitGoal, NIGHT_ARMOR_PRIORITY } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const SAFE = { hasIronPick: true, actionable: 0, food: 20, hasTablePath: true, stuckMob: false, canSmeltHere: true, fuelUnits: 256 };

test('T-0192 不变量: 护甲点 <8 + 铁 ≥8 (够胸甲) → armorNightWarranted 必真 (death #12: 29 粗铁 0 甲)', () => {
    for (const iron of [8, 11, 29]) for (const have of [[], ['iron_helmet'], ['iron_boots', 'iron_helmet'], ['leather_chestplate']]) {
        if (armorPoints(have) >= 8) continue;
        const has = have.some(n => /_chestplate$/.test(n));
        const ok = armorNightWarranted({ ...SAFE, armorHave: have, rawIron: iron, ingots: 0 });
        assert.equal(ok, true, `iron ${iron}, have ${have} (chest ${has})`);
    }
    assert.equal(armorNightWarranted({ ...SAFE, armorHave: [], rawIron: 29, ingots: 0, hasIronPick: false }), false, 'no iron pick → pick first (SMELT_IRON pick branch)');
});

test('T-0192 不变量: 夜间造甲提案优先级严格高于整夜下矿 (同分抢不下承诺)', () => {
    assert.ok(NIGHT_ARMOR_PRIORITY > 94, `${NIGHT_ARMOR_PRIORITY} > DUSK_MINE_NIGHT 94`);
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'night', isDay: false };
    w.kit = { ...w.kit, picks: 3, pickTier: 'iron', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 20, food: 20, armor: 0 };
    w.nightPlan = { decision: 'SMELT_IRON' };
    const inv = { iron_pickaxe: 1, stone_pickaxe: 2, iron_sword: 1, raw_iron: 29, coal: 32, cobblestone: 200, crafting_table: 1 };
    const bot = { inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
        game: { dimension: 'overworld' }, entity: { position: { x: -1, y: 4, z: -30 } }, health: 20, food: 20,
        _commitment: { kind: 'DUSK_MINE_NIGHT', skill: 'mineDown', args: [{ targetY: 12 }], since: Date.now() - 60000 } };
    const props = proposeTasks(w, bot);
    const armor = props.find(p => p.kind === 'NIGHT_SMELT_IRON');
    assert.ok(armor && armor.skill === 'craftArmor' && armor.priority > 94, JSON.stringify(armor));
    // 已承诺夜挖 (live 23:46 起) → 造甲提案必须抢下
    const mine = { kind: 'DUSK_MINE_NIGHT', priority: 94, skill: 'mineDown', args: [{ targetY: 12 }] };
    const g = commitGoal(bot, [armor, mine], w);
    assert.equal(g.kind, 'NIGHT_SMELT_IRON', `committed mining must yield to armor (got ${g.kind})`);
});

test('T-0192 不变量: computeNightPlan 链里造甲档排在整夜下矿之前, 且用 armorNightWarranted 纯函数', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('const computeNightPlan = () =>'));
    const iArmor = fn.indexOf("when: _armorNightWarranted"), iMine = fn.indexOf("{ decision: 'MINE_THROUGH_NIGHT', when");
    assert.ok(iArmor > 0 && iMine > iArmor, `armor ${iArmor} before mine ${iMine}`);
    assert.ok(/const _armorNightWarranted = armorNightWarranted\(/.test(src));
});
