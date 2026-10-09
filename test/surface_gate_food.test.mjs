// T-0125: 食物本能关 (MC_FOOD_INSTINCTS=0) 时 surfaceGate 'low food' hold 永不解除 → tierReady/GO_UNDERGROUND
// 全被挡 → FREE_PLAY@1 地表罚站 (实录 10-10 17:18→, food 6, 3 铁镐+盔+靴, 圆石 339)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceGateAuto } from '../src/agent/framework/surface_gate.js';

const day = { isNight: false, isDusk: false, actionable: 0, sufficientForUnderground: true, picks: 5 };

test('T-0125: 食物本能关 + 低食物 + 装备齐 → 不得 hold (无提案能补食物, hold 永不解除)', () => {
    assert.equal(surfaceGateAuto({ ...day, foodSufficient: false, foodInstincts: false }).mode, 'free');
});

test('T-0125: 食物本能开时 low food hold 照旧; 夜/威胁/缺镐的 hold 不受影响', () => {
    assert.deepEqual(surfaceGateAuto({ ...day, foodSufficient: false, foodInstincts: true }), { mode: 'hold', reason: 'low food' });
    assert.equal(surfaceGateAuto({ ...day, isNight: true, foodSufficient: true, foodInstincts: false }).mode, 'hold');
    assert.equal(surfaceGateAuto({ ...day, actionable: 2, foodSufficient: true, foodInstincts: false }).mode, 'hold');
    assert.equal(surfaceGateAuto({ ...day, sufficientForUnderground: false, foodSufficient: true, foodInstincts: false }).mode, 'hold');
    assert.equal(surfaceGateAuto({ ...day, sufficientForUnderground: false, picks: 0, foodSufficient: true, foodInstincts: false }).mode, 'free', 'C289 pickless surfaces');
});
