// T-0123: ENTOMBED 挖出 burst 里的无超时 await (bot.equip/equipForBlock/lookAt) 挂住 → execute 永不返回 →
// mobility 一直 active, 模式循环停转, mob 冻在 ENTOMBED, kernelDriver 对 ENTOMBED 让位 → 3min 零动作
// (实录 10-10 17:00:48 "Entombed — digging out!" 后再无 "Mode mobility finished", 靠 pin-kick 才破)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withBurstDeadline } from '../src/agent/framework/mobility_signals.js';

test('T-0123: burst 里的 await 永不 resolve → 截止时间到即返回, 并回调 onTimeout', async () => {
    let timedOut = false;
    const run = withBurstDeadline(() => new Promise(() => {}), 80, () => { timedOut = true; });
    const t0 = Date.now();
    await run();
    assert.ok(Date.now() - t0 < 1000, 'returned on deadline');
    assert.equal(timedOut, true);
});

test('T-0123: 正常 burst 先完成 → 不触发 onTimeout, 异常照常抛出', async () => {
    let timedOut = false;
    await withBurstDeadline(async () => {}, 500, () => { timedOut = true; })();
    assert.equal(timedOut, false);
    await assert.rejects(withBurstDeadline(async () => { throw new Error('boom'); }, 500)(), /boom/);
});

test('T-0123: modes.js 的 ENTOMBED 与 SEALED 挖出 execute 都包了截止时间', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    for (const st of ['ENTOMBED', 'SEALED']) {
        const i = src.indexOf(`} else if (st === '${st}') {`);
        assert.ok(i > 0, st);
        const exec = src.indexOf('execute(this, agent,', i);
        assert.equal(src.slice(exec, exec + 60).includes('withBurstDeadline('), true, `${st} execute must be bounded`);
    }
});
