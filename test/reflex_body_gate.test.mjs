// T-0231 身体所有权缺口 (death #22 04:51:13: ctrl `forward,back,right,sneak,sprint` + path=1 — branchMine 寻路与 sprintFlee 同时驱动)。
// 契约: 反射 mode 持身期间, 来自技能调用链的 setGoal / 移动键 / 清键一律拒绝; 插件 tick (pathfinder/pvp, 无链标记) 与反射
// 自己 (含反射调用的 customSkill) 放行; goto 式调用被拒时 reject 而非悬挂。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installReflexBodyGate, skillCtx, reflexCtx, runAsSkill } from '../src/agent/framework/reflex_body_gate.js';

function fakeBot() {
    const calls = { set: [], clear: 0 };
    const bot = {
        _bodyOwner: null,
        pathfinder: { goal: null, setGoal(g) { this.goal = g; } },
        setControlState(c, s) { calls.set.push(`${c}=${s}`); },
        clearControlStates() { calls.clear++; },
    };
    bot.pathfinder.goto = function (goal) { return new Promise((res, rej) => { try { this.setGoal(goal); res(true); } catch (e) { rej(e); } }); };
    installReflexBodyGate(bot);
    return { bot, calls };
}
class GoalNear { constructor() {} }

test('T-0231: 反射持身时, 技能链的 setGoal 抛错 / 移动键与清键被忽略; setGoal(null) 与松键照常', async () => {
    const { bot, calls } = fakeBot();
    bot._bodyOwner = { name: 'mode:self_preservation', kind: 'mode' };
    await skillCtx.run({ skill: 'branchMine' }, async () => {
        assert.throws(() => bot.pathfinder.setGoal(new GoalNear()), /reflex holds the body/);
        await assert.rejects(bot.pathfinder.goto(new GoalNear()), /reflex holds the body/, 'goto rejects, never hangs');
        bot.setControlState('forward', true);
        bot.setControlState('sneak', false);
        bot.clearControlStates();
        bot.pathfinder.setGoal(null);
    });
    assert.deepEqual(calls.set, ['sneak=false'], 'only releasing a key passes');
    assert.equal(calls.clear, 0, 'a skill must not cancel the reflex sprint');
    assert.equal(bot.pathfinder.goal, null);
});

test('T-0231: 插件 tick (无链标记) 与反射链 (含反射调用的 customSkill) 放行; 技能持身时技能链照常', async () => {
    const { bot, calls } = fakeBot();
    bot._bodyOwner = { name: 'mode:self_defense', kind: 'mode' };
    bot.setControlState('jump', true);                                  // pathfinder/pvp physicsTick — no chain store
    const g = new GoalNear(); bot.pathfinder.setGoal(g);
    assert.equal(bot.pathfinder.goal, g);
    await reflexCtx.run({ mode: 'self_defense' }, () => runAsSkill('shieldFight', async () => {
        bot.setControlState('forward', true);                           // reflex-invoked customSkill stays reflex
    }));
    bot._bodyOwner = { name: 'kernel:branchMine', kind: 'skill' };
    await skillCtx.run({ skill: 'branchMine' }, async () => { bot.setControlState('back', true); bot.pathfinder.setGoal(new GoalNear()); });
    assert.deepEqual(calls.set, ['jump=true', 'forward=true', 'back=true']);
});

test('T-0231 fix (03:58:34 实录 shieldFight 被拦): 反射 execute 从技能链里触发时两个标记都在 — 反射标记优先, 照常放行', async () => {
    const { bot, calls } = fakeBot();
    bot._bodyOwner = { name: 'mode:self_defense', kind: 'mode' };
    await skillCtx.run({ skill: 'quickMeal' }, () => reflexCtx.run({ mode: 'self_defense' }, () => runAsSkill('shieldFight', async () => {
        const g = new GoalNear();
        bot.pathfinder.setGoal(g);
        assert.equal(bot.pathfinder.goal, g, 'the reflex fight may path');
        bot.setControlState('forward', true);
    })));
    assert.deepEqual(calls.set, ['forward=true']);
    await skillCtx.run({ skill: 'quickMeal' }, async () => {
        assert.throws(() => bot.pathfinder.setGoal(new GoalNear()), /reflex holds the body/, 'the plain skill chain is still gated');
    });
});

test('T-0231: 接线 — customSkill 走 runAsSkill; execute 在 reflexCtx 里跑并清掉技能残留寻路目标; initModes 装闸', () => {
    const sk = fs.readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    assert.match(sk, /return await runAsSkill\(skillName, \(\) => fn\(bot, ctx, \.\.\.args\)\);/);
    const m = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const ex = m.slice(m.indexOf('async function execute(mode, agent, func'), m.indexOf('export function initModes'));
    assert.match(ex, /pathfinder\.goal\) agent\.bot\.pathfinder\.setGoal\(null\);\s*\} catch \(e\) \{\}\s*setBodyOwner\(agent\.bot, `mode:\$\{mode\.name\}`, 'mode'\);/, 'stale skill goal dropped before taking ownership');
    assert.match(ex, /await reflexCtx\.run\(\{ mode: mode\.name \}, \(\) => agent\.actions\.runAction\(/);
    assert.match(m.slice(m.indexOf('export function initModes')), /installReflexBodyGate\(agent\.bot,/);
});
