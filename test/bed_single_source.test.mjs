// T-0220 (监工, 2026-10-10 04:04:44-04:05:21Z): 第二个 GET_BED 提案源派给旧 prepNether, 判据与 bedErrand 不同源 →
// "prepNether NO-OP | all goals held at entry" ×3 → GET_BED 冷却 (连 bedErrand 一起挡)。当时 bot 在 y13 地下, 一只够不着的骷髅在射它。
// T-0221: 头顶地表的羊 (dy≈56) 按 3D 距离也在 64 格内 → 判可行。修: 唯一提案源 (永远 bedErrand) + 唯一谓词 bedProposable (isGoalDone 同源)。
import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { proposeTasks, isGoalDone, bedErrandFeasible, bedProposable } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

function makeBot(inv, ents = [], y = 64) {
    const items = Object.entries(inv).map(([name, count]) => ({ name, count }));
    const entities = Object.fromEntries(ents.map(([name, x, z, ey], i) => [i + 1, { name, position: new Vec3(x, ey ?? 64, z) }]));
    return { inventory: { items: () => items, slots: [] }, game: { dimension: 'overworld' }, time: { timeOfDay: 2000 },
        entity: { position: new Vec3(0, y, 0) }, entities, health: 20, food: 9 };
}
function world({ food = 9, stone = false } = {}) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { tod: 2000, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 2, pickTier: stone ? 'stone' : 'wooden' };
    w.vitals = { ...w.vitals, hp: 17, food };
    return w;
}
const beds = (w, bot) => proposeTasks(w, bot).filter(p => p.kind === 'GET_BED');

test('T-0220: 所有 GET_BED 提案都派 bedErrand (不再有 prepNether 源); 包里羊毛 / 同高度羊 / 侦察条件三种来路都一样', () => {
    for (const [w, bot] of [[world(), makeBot({ wooden_pickaxe: 2, white_wool: 3 })],
                            [world(), makeBot({ wooden_pickaxe: 2 }, [['sheep', 30, 0]])],
                            [world({ food: 14, stone: true }), makeBot({ stone_pickaxe: 2, stone_sword: 1 })]]) {
        const ps = beds(w, bot);
        assert.equal(ps.length, 1, JSON.stringify(ps));
        assert.equal(ps[0].skill, 'bedErrand');
    }
});

test('T-0221: y13 地下, 羊在头顶地表 (dy≈56, 3D 距离 <64) → 不可行、不提; 同一高度带 (dy≤12) 的羊才算', () => {
    const under = makeBot({ wooden_pickaxe: 2 }, [['sheep', 10, 5, 69]], 13);
    assert.equal(bedErrandFeasible(under), false);
    assert.equal(beds(world(), under).length, 0);
    const level = makeBot({ wooden_pickaxe: 2 }, [['sheep', 30, 0, 72]], 64);
    assert.equal(bedErrandFeasible(level), true);
});

test('T-0220: 16 格内有视线可达的敌对 (在射的骷髅) → 不提 GET_BED, 已承诺的立即释放 (isGoalDone 同谓词)', () => {
    const shot = makeBot({ wooden_pickaxe: 2, white_wool: 3 }, [['sheep', 20, 0], ['skeleton', 12, 6, 70]]);
    assert.equal(bedProposable(world(), shot), false);
    assert.equal(beds(world(), shot).length, 0);
    assert.equal(isGoalDone('GET_BED', world(), shot), true);
    const calm = makeBot({ wooden_pickaxe: 2, white_wool: 3 }, [['sheep', 20, 0]]);
    assert.equal(isGoalDone('GET_BED', world(), calm), false);
});

test('T-0222: 墙后够不着的骷髅 (无视线) 不挡 GET_BED; 同一只骷髅有视线 → 挡 (hostile_reach 同谓词)', () => {
    const bot = makeBot({ wooden_pickaxe: 2, white_wool: 3 }, [['sheep', 20, 0], ['skeleton', 8, 0, 64]]);
    bot.entities[2].type = 'hostile';
    bot.blockAt = (q) => (Math.floor(q.x) === 4 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' });
    assert.equal(bedProposable(world(), bot), true, 'walled skeleton ignored');
    assert.equal(beds(world(), bot).length, 1);
    bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' });
    assert.equal(bedProposable(world(), bot), false, 'skeleton in view blocks');
});
