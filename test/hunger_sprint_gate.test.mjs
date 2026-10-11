// T-0273 (监工加急 2026-10-11 06:02:21→06:04:20Z): FOOD_FLOOR 侦察 food 9 起, 两轮 "moved 322b/308b in 90.0s" 一路疾跑
// (0.1 消耗/格 ≈ 32 消耗值 = 9 点饥饿全烧光) → food 0 掉血到 hp 3, 侦察越找越饿。1.21 走路零消耗。
// 修 = 饥饿禁疾跑总闸: food ≤ 10 且无可动敌对 → setControlState('sprint', true) 改 false (pathfinder 也走这里), movements.allowSprinting=false。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installHungerSprintGate, sprintAllowed, SPRINT_FOOD_MAX } from '../src/agent/library/skills.js';

function fakeBot(food, actionable = 0) {
    const ctrl = {};
    const pf = { movements: null, goal: null, setMovements(m) { this.movements = m; }, setGoal(g) { this.goal = g; } };
    return { food, _world: { threat: { actionable } }, ctrl, pathfinder: pf, setControlState(c, s) { ctrl[c] = s; } };
}

test('T-0273: food 9 的侦察 → movements.allowSprinting=false, pathfinder 要疾跑也只走', () => {
    const bot = fakeBot(9);
    assert.equal(installHungerSprintGate(bot), true);
    bot.pathfinder.setMovements({ allowSprinting: true });
    assert.equal(bot.pathfinder.movements.allowSprinting, false);
    bot.setControlState('sprint', true);                  // mineflayer-pathfinder monitorMovement 就是这么疾跑的
    assert.equal(bot.ctrl.sprint, false);
    bot.setControlState('forward', true);
    assert.equal(bot.ctrl.forward, true, 'walking untouched');
});

test('T-0273: 吃饱 (food>10) 照常疾跑; 饿着但有可动敌对 (躲避) 允许疾跑; 吃饱后恢复 movements', () => {
    assert.equal(SPRINT_FOOD_MAX, 10);
    const full = fakeBot(18); installHungerSprintGate(full);
    full.pathfinder.setMovements({ allowSprinting: true });
    full.setControlState('sprint', true);
    assert.equal(full.ctrl.sprint, true);
    assert.equal(full.pathfinder.movements.allowSprinting, true);
    assert.equal(sprintAllowed(fakeBot(4, 1)), true, 'fleeing an actionable hostile may sprint');
    const b = fakeBot(9); installHungerSprintGate(b);
    b.pathfinder.setMovements({ allowSprinting: true });
    assert.equal(b.pathfinder.movements.allowSprinting, false);
    b.food = 20; b.pathfinder.setGoal({});
    assert.equal(b.pathfinder.movements.allowSprinting, true, 'restored once fed');
    const own = fakeBot(20); installHungerSprintGate(own);
    own.pathfinder.setMovements({ allowSprinting: false }); own.food = 20; own.pathfinder.setGoal({});
    assert.equal(own.pathfinder.movements.allowSprinting, false, "a skill's own no-sprint is never flipped on");
});

test('T-0273: 边界 — food 正好 10 已禁疾跑, 11 才放; modes.js 真的装了总闸', async () => {
    // worker-tests 变异 10-11: `f > SPRINT_FOOD_MAX` 改成 `>=` (food 10 照跑) 与删掉 modes.js 的安装调用, 上两条均照绿
    assert.equal(sprintAllowed(fakeBot(SPRINT_FOOD_MAX)), false, 'food 10 → walk');
    assert.equal(sprintAllowed(fakeBot(SPRINT_FOOD_MAX + 1)), true, 'food 11 → may sprint');
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(src, /try \{ skills\.installHungerSprintGate\(bot\); \} catch \(e\) \{\}/);
});

test('T-0273 (监工验收): movements 被置 false 时也写 [sprint-gate] 诊断 — 之后 pathfinder 不再请求疾跑, grep 验收不会误判', () => {
    const bot = fakeBot(5); installHungerSprintGate(bot);
    assert.equal(bot._sprintGateLogAt, undefined);
    bot.pathfinder.setMovements({ allowSprinting: true });   // 只走 movements 路径, 从不调 setControlState('sprint', true)
    assert.ok(bot._sprintGateLogAt > 0, 'diagnostic line written on the movements path too');
    const src = fs.readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    assert.ok(src.includes("logGate('movements.allowSprinting=false')"));
});
