// T-0234 (death 22:59:46, 反射全程沉默): 两个 surfaceUp 重叠 (22:57:01 孤儿 A + 22:59:19 新入 B)。旧写法各自"记原值→关→恢复":
// B 把被 A 关掉的 off 记成原值, A 先退出恢复 on, B 后退出恢复 off → self_defense/self_preservation 永久关着, 骷髅贴脸无人出手。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { acquireModeFreeze } from '../src/agent/framework/mode_freeze.js';

function fakeBot() {
    const on = { self_defense: true, self_preservation: true, mobility: true, auto_eat: true };
    return { on, modes: { exists: (m) => m in on, isOn: (m) => on[m], setOn: (m, v) => { on[m] = v; } } };
}
const GUARD = ['mobility', 'self_preservation', 'self_defense', 'auto_eat'];

test('T-0234: 实录交错 A 进→B 进→A 出→B 出 — 反射最终必须恢复为开 (旧写法留成关)', () => {
    const bot = fakeBot();
    const A = acquireModeFreeze(bot, GUARD, { now: 1000 });
    assert.equal(bot.on.self_defense, false);
    const B = acquireModeFreeze(bot, GUARD, { now: 2000 });
    assert.equal(B.prev.self_defense, true, 'B sees the ORIGINAL value, not the frozen off');
    A.release();
    assert.equal(bot.on.self_defense, false, 'still frozen while B holds');
    B.release();
    assert.equal(bot.on.self_defense, true);
    assert.equal(bot.on.self_preservation, true);
});

test('T-0234: 遇险 unfreeze 立即还给反射, 之后其他持有者 release 不再把它关回去; 孤儿冻结超 5 分钟被下一次 acquire 恢复', () => {
    const bot = fakeBot();
    const A = acquireModeFreeze(bot, GUARD, { now: 0 });
    const B = acquireModeFreeze(bot, GUARD, { now: 10 });
    B.unfreeze('self_defense');
    assert.equal(bot.on.self_defense, true, 'danger → reflex live now');
    A.release(); B.release();
    assert.equal(bot.on.self_defense, true);
    const bot2 = fakeBot();
    acquireModeFreeze(bot2, GUARD, { now: 0 });                    // orphan never releases
    const C = acquireModeFreeze(bot2, GUARD, { now: 400000 });     // > 5 min later
    C.release();
    assert.equal(bot2.on.self_defense, true, 'orphaned freeze does not pin reflexes off forever');
});

test('T-0234: 6 处"记原值→关→恢复"全部改用共享原语', () => {
    const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
    for (const p of ['../bots/_supervisor/skills/surfaceUp.js', '../src/agent/framework/tools/bunker.js', '../bots/_supervisor/skills/achieve.js']) {
        const s = src(p);
        assert.match(s, /acquireModeFreeze\(bot, /, p);
        assert.ok(!/\[m\] = bot\.modes\.isOn\(m\); bot\.modes\.setOn\(m, false\)/.test(s), `${p}: no private save/restore left`);
    }
    const sk = src('../src/agent/library/skills.js');
    assert.equal((sk.match(/acquireModeFreeze\(bot, /g) || []).length, 3);
    assert.ok(!/\[m\] = bot\.modes\.isOn\(m\); bot\.modes\.setOn\(m, false\)/.test(sk));
});
