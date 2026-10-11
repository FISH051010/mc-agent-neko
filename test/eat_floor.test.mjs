// T-0155: 2026-10-10 y16 hp=1 food=0, 背包 rotten_flesh×2 一直没吃 — auto_eat 被仲裁器
// holder=ws:* (kernelDriver 派发的受监督技能) 经 LLM 4s 超时回退压死。就地进食必须赢。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arb-eat-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.copyFileSync(path.join(repo, 'bots', '_supervisor', 'arbitration.json'),
    path.join(home, 'bots', '_supervisor', 'arbitration.json'));
process.env.MC_AGENT_HOME = home;

const { resolve } = await import('../src/agent/framework/arbiter.js');
const { pickAutoEatFood } = await import('../src/agent/framework/healing_reflex.js');

const WS = { name: 'ws:*', kind: 'skill', since: 0 };
const EAT = { name: 'mode:auto_eat', kind: 'mode', vital: false };
// prompter 在场 = 执法路径, live 现场就是 pending → LLM 超时 → holder
const agentFor = (bot) => ({ bot, prompter: { chat_model: { sendRequest: () => new Promise(() => {}) } } });

test('T-0155: 饿到掉血 (food≤6 或 hp≤12&&food<18) 时 auto_eat 压过受监督技能 holder', () => {
    for (const [hp, food] of [[1, 0], [20, 6], [10, 15]]) {
        const v = resolve(WS, EAT, { agent: agentFor({ health: hp, food }), detail: 'test' });
        assert.equal(v.winner, 'claimant', `hp${hp}/food${food}: ${JSON.stringify(v)}`);
    }
    const kernel = resolve({ name: 'kernel:replenishKit', kind: 'kernel' }, EAT, { agent: agentFor({ health: 1, food: 0 }) });
    assert.equal(kernel.winner, 'claimant');
});

test('T-0155: 不饿 (hp18 food15) 不走进食地板; holder 是 mode 时也不走', () => {
    const v = resolve(WS, EAT, { agent: agentFor({ health: 18, food: 15 }) });
    assert.notEqual(v.source, 'floor');
    const m = resolve({ name: 'mode:self_defense', kind: 'mode' }, EAT, { agent: agentFor({ health: 1, food: 0 }), enforce: false });
    assert.notEqual(m.source, 'floor');
});

test('T-0155: 挑食 — food0 只有腐肉+生鸡肉 → 吃腐肉; 绝不挑生鸡肉; 熟食先于生肉', () => {
    const inv = [{ name: 'chicken', count: 3 }, { name: 'rotten_flesh', count: 2 }, { name: 'spruce_log', count: 11 }];
    assert.equal(pickAutoEatFood(inv, { health: 1, food: 0 }).name, 'rotten_flesh');
    // ★T-0230: 别无可吃且 food≤3 → 生鸡是最后手段 (10-11 hp1 food0 只剩生鸡空转 1h+); 有腐肉仍先腐肉, 不饿仍不吃生鸡
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 3 }], { health: 1, food: 0 }).name, 'chicken');
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 3 }], { health: 20, food: 8 }), null);
    assert.equal(pickAutoEatFood(inv, { health: 18, food: 15 }), null, '不饿不吃腐肉');
    assert.equal(pickAutoEatFood([{ name: 'beef' }, { name: 'cooked_beef' }], { health: 10, food: 10 }).name, 'cooked_beef');
    assert.equal(pickAutoEatFood([{ name: 'cooked_chicken' }], { health: 10, food: 10 }).name, 'cooked_chicken');
});
