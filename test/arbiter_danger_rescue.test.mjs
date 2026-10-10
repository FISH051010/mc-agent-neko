// T-0182 #33: 仲裁器 LLM 负缓存压救命反射 — 挨打/溺水时受监督技能 (ws:* / watchdog:*) 不掌舵,
// 'holder' 的 30s 超时负缓存 (或 4s pending) 就是"危险无人掌舵"。契约: 让位必须以接收方此刻在掌舵为前提。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arb-danger-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.copyFileSync(path.join(repo, 'bots', '_supervisor', 'arbitration.json'),
    path.join(home, 'bots', '_supervisor', 'arbitration.json'));
process.env.MC_AGENT_HOME = home;

const { resolve } = await import('../src/agent/framework/arbiter.js');

const WS = { name: 'ws:*', kind: 'skill', since: 0 };
const WATCHDOG = { name: 'watchdog:*', kind: 'skill', since: 0 };
const NIGHT = { name: 'kernel:nightShelter', kind: 'skill', since: 0 };
const claim = (m) => ({ name: `mode:${m}`, kind: 'mode', vital: false });
const pos = { x: 0, y: 40, z: 0, offset(dx, dy, dz) { return { x: this.x + dx, y: this.y + dy, z: this.z + dz }; } };

function fakeBot({ hurtAgoMs = Infinity, headWater = false, oxygen = 20, cachedHolder = false } = {}) {
    const bot = {
        _mobility: { state: 'SWIM_STUCK' },
        lastDamageTime: Number.isFinite(hurtAgoMs) ? Date.now() - hurtAgoMs : 0,
        oxygenLevel: oxygen,
        entity: { position: pos },
        blockAt: (p) => ({ name: p.y === 41 && headWater ? 'water' : 'stone' }),
    };
    if (cachedHolder) {
        // 上一次 LLM 4s 超时留下的 30s 负缓存 (实录 22:25 ws:* vs mode:mobility llm-fallback ×3)
        bot._arb = { doc: null, docAt: 0, asking: {}, logAt: {}, verdicts: {} };
        for (const h of [WS, WATCHDOG]) for (const m of ['self_defense', 'self_preservation', 'mobility'])
            bot._arb.verdicts[`${h.name}→mode:${m}`] = { winner: 'holder', why: 'llm timeout', source: 'llm-fallback', at: Date.now(), ttl: 30000 };
    }
    return bot;
}
const agentFor = (bot) => ({ bot, prompter: { chat_model: { sendRequest: () => new Promise(() => {}) } } });

test('T-0182 #33: 挨打中 (≤3s) 救命反射 vs 受监督技能 — 负缓存 holder 也不能压, 判给 claimant', () => {
    for (const h of [WS, WATCHDOG]) for (const m of ['self_defense', 'mobility']) {
        const bot = fakeBot({ hurtAgoMs: 500, cachedHolder: true });
        const v = resolve(h, claim(m), { agent: agentFor(bot), enforce: true });
        assert.equal(v.winner, 'claimant', `${h.name} vs ${m}: got ${v.winner} (${v.source}: ${v.why})`);
    }
});

test('T-0182 #33: 头在水里 O2<12 — SWIM_STUCK mobility 不得被 ws:* 的 llm-fallback 压 30s', () => {
    const bot = fakeBot({ headWater: true, oxygen: 6, cachedHolder: true });
    const v = resolve(WS, claim('mobility'), { agent: agentFor(bot), enforce: true });
    assert.equal(v.winner, 'claimant', `got ${v.winner} (${v.source}: ${v.why})`);
});

test('T-0182 #33: 无危险时不越权 — 负缓存/pending 照旧 (陆上陈旧 O2 不算溺水, 头在水里满氧不算)', () => {
    for (const opts of [{}, { oxygen: 1 }, { headWater: true, oxygen: 20 }, { hurtAgoMs: 5000 }]) {
        const bot = fakeBot({ ...opts, cachedHolder: true });
        const v = resolve(WS, claim('mobility'), { agent: agentFor(bot), enforce: true });
        assert.notEqual(v.winner, 'claimant', `${JSON.stringify(opts)}: got ${v.winner} (${v.why})`);
    }
});

test('T-0182 #33: 矩阵规则优先 — 自愿封顶 kernel:nightShelter vs mobility=holder 不被挨打推翻; 非救命反射不受地板', () => {
    const bot = fakeBot({ hurtAgoMs: 200 });
    assert.equal(resolve(NIGHT, claim('mobility'), { agent: agentFor(bot), enforce: true }).winner, 'holder');
    assert.notEqual(resolve(WS, claim('item_collecting'), { agent: agentFor(fakeBot({ hurtAgoMs: 200 })), enforce: true }).winner, 'claimant');
});
