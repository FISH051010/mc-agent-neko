// T-0080: kernelDriver 让位 mobility ↔ 仲裁器判 holder(ws:*) 胜 = 互相让位死锁 (3min 零动作)。
// 契约: 决策层为反射让位时, 仲裁器必须让那个反射拿到身体。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 隔离: 仲裁器会写 arbitration.json/progress.txt — 指到临时 HOME, 但用仓库里的真矩阵
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arb-yield-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.copyFileSync(path.join(repo, 'bots', '_supervisor', 'arbitration.json'),
    path.join(home, 'bots', '_supervisor', 'arbitration.json'));
process.env.MC_AGENT_HOME = home;
process.chdir(home);   // kernelDriver 的 prog() 按 cwd 写 progress.txt

const { resolve } = await import('../src/agent/framework/arbiter.js');
const { default: kernelDriver } = await import('../bots/_supervisor/skills/kernelDriver.js');

const WS_HOLDER = { name: 'ws:*', kind: 'skill', since: 0 };
const MOBILITY = { name: 'mode:mobility', kind: 'mode', vital: false };

function fakeBot(state, extra = {}) {
    return {
        game: { dimension: 'overworld' },
        _mobility: { state },
        _world: { threat: { actionable: 0 }, vitals: { food: 17 } },
        _commitment: { kind: 'REPLENISH_KIT', skill: 'replenishKit', args: [] },
        entity: null,
        ...extra,
    };
}
// prompter 在场 = 执法路径会去问 LLM (live 现场就是这样拿到 pending→llm 超时→holder)
const agentFor = (bot) => ({ bot, prompter: { chat_model: { sendRequest: () => new Promise(() => {}) } } });

// 跑 kernelDriver 恰好一轮: 第一次 wait() 就打 supervisor cancel, 下一轮 loop-top 返回
async function runOneKernelIteration(bot) {
    const dispatched = [];
    const ctx = {
        skills: {
            wait: async () => { bot._supervisorCancelAt = Date.now(); },
            customSkill: async (_b, name) => { dispatched.push(name); },
        },
        world: { getInventoryCounts: () => ({}) },
    };
    await kernelDriver(bot, ctx);
    return dispatched;
}

test('T-0080: kernelDriver 为 MAROONED 让位时, 仲裁器必须把身体判给 mode:mobility (不得 pending/holder 互等)', async () => {
    const bot = fakeBot('MAROONED');
    const dispatched = await runOneKernelIteration(bot);
    assert.deepEqual(dispatched, [], 'MAROONED 时 kernelDriver 不派发 (让位反射)');
    const v = resolve(WS_HOLDER, MOBILITY, { agent: agentFor(bot), enforce: true });
    assert.equal(v.winner, 'claimant', `让位中的派发器不能赢: got ${v.winner} (${v.source}: ${v.why})`);
});

test('T-0080: 每种 kernelDriver 让位的 mobility 状态 (POCKET/SWIM/SWIM_STUCK/MAROONED) 都必须放行 mobility', async () => {
    for (const state of ['POCKET', 'SWIM', 'SWIM_STUCK', 'MAROONED']) {
        const bot = fakeBot(state);
        await runOneKernelIteration(bot);
        const v = resolve(WS_HOLDER, MOBILITY, { agent: agentFor(bot), enforce: true });
        assert.equal(v.winner, 'claimant', `${state}: got ${v.winner} (${v.why})`);
    }
});

test('T-0080: 真被封死 ENTOMBED/SEALED — 子技能在跑 (无让位戳) 也必须放 mobility 挖出', () => {
    for (const state of ['ENTOMBED', 'SEALED']) {
        const bot = fakeBot(state);
        const v = resolve(WS_HOLDER, MOBILITY, { agent: agentFor(bot), enforce: true });
        assert.equal(v.winner, 'claimant', `${state}: got ${v.winner} (${v.why})`);
    }
});

test('T-0080: 子技能正在跑 (派发器没在让位) 的 soft MAROONED 不被地板强抢 — 照旧走矩阵/LLM', () => {
    const bot = fakeBot('MAROONED');
    const v = resolve(WS_HOLDER, MOBILITY, { agent: agentFor(bot), enforce: true });
    assert.notEqual(v.winner, 'claimant');
});

test('T-0080: 让位戳过期 (>3s) 不再生效', () => {
    const bot = fakeBot('MAROONED', { _dispatchYield: { reason: 'mobility', state: 'MAROONED', at: Date.now() - 10000 } });
    const v = resolve(WS_HOLDER, MOBILITY, { agent: agentFor(bot), enforce: true });
    assert.notEqual(v.winner, 'claimant');
});
