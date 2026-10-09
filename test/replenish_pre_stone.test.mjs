// T-0118: 木器阶段补给不变量 (3 镐/64 板) 把 bot 钉在地表补木 — 10-10 新世界 40min 零圆石。
// 石器前补给只求够下矿 (2 镐 + 随身台 + 16 板); 有石镐后的宽迟滞 (3 镐/64 板, 用户 07-05 令) 不变。
import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeTasks, isGoalDone, replenishTargets } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

const fakeBot = (inv) => ({
    inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, health: 20, food: 20,
});
function dayWorld(kit) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, ...kit };
    return w;
}

test('T-0118: 木器阶段 2 木镐 + 台 + 16 板 → 不再提 REPLENISH_KIT, 已提的视为完成 (放行下矿)', () => {
    const inv = { wooden_pickaxe: 2, crafting_table: 1, spruce_log: 4, stick: 4 };
    const w = dayWorld({ picks: 2, pickTier: 'wood', sufficientForUnderground: true });
    const bot = fakeBot(inv);
    assert.equal(proposeTasks(w, bot).find(p => p.kind === 'REPLENISH_KIT'), undefined);
    assert.equal(isGoalDone('REPLENISH_KIT', w, bot), true);
    const top = proposeTasks(w, bot).filter(p => p.kind !== 'OPENING_SCOUT').sort((a, b) => b.priority - a.priority)[0];
    assert.equal(top.kind, 'GO_UNDERGROUND', `top=${top.kind}@${top.priority}`);
});

test('T-0118: 有石镐后宽迟滞口径不变 (3 镐 / 64 板)', () => {
    assert.deepEqual(replenishTargets(dayWorld({ pickTier: 'stone' })), { picksMin: 3, planksRelease: 64 });
    const inv = { stone_pickaxe: 2, crafting_table: 1, spruce_log: 4, stick: 4 };
    const w = dayWorld({ picks: 2, pickTier: 'stone', sufficientForUnderground: true });
    assert.equal(isGoalDone('REPLENISH_KIT', w, fakeBot(inv)), false, 'stone tier still restocks to 3 picks / 64 planks');
});

test('T-0118: 木器阶段仍有补给底线 — 1 镐或木料<4 照样触发', () => {
    const w = dayWorld({ picks: 1, pickTier: 'wood', sufficientForUnderground: false });
    assert.ok(proposeTasks(w, fakeBot({ wooden_pickaxe: 1, spruce_log: 10 })).find(p => p.kind === 'REPLENISH_KIT'));
});
