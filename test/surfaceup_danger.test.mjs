// death #17 (2026-10-10 02:37:09, T-0169 同形第二次): quickMeal → surfaceUp 上浮, surfaceUp 冻结 self_defense/self_preservation
// 整段上浮; 寻路掉进僵尸所在洞 → 0.8b 僵尸连打 17→0, 背包石剑零出手 (act 全空, 手持 andesite)。
// 契约 (让位必须有人接): 冻结反射的前提是"此刻无危险"; 一有危险 → 当拍解冻战斗反射并放弃上浮。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { surfaceUpDangerYield } from '../bots/_supervisor/skills/surfaceUp.js';

test('death #17: 贴脸近战怪 / 正在被怪打 → surfaceUp 让位; 坠落/窒息自伤 (无怪) 与远处/高处的怪不算', () => {
    assert.equal(surfaceUpDangerYield({ hurtAgoMs: 1e9, hostiles: [{ name: 'zombie', d: 0.8, dy: -1 }] }), true, 'death #17 02:37:03');
    assert.equal(surfaceUpDangerYield({ hurtAgoMs: 500, hostiles: [{ name: 'zombie', d: 5.1, dy: -4 }] }), true, 'hit by a mob this second');
    assert.equal(surfaceUpDangerYield({ hurtAgoMs: 500, hostiles: [] }), false, 'own fall / suffocation — keep climbing');
    assert.equal(surfaceUpDangerYield({ hurtAgoMs: 1e9, hostiles: [{ name: 'zombie', d: 10.8, dy: -4 }] }), false);
    assert.equal(surfaceUpDangerYield({ hurtAgoMs: 1e9, hostiles: [{ name: 'zombie', d: 3, dy: -5 }] }), false, 'below the shaft, cannot reach');
    assert.equal(surfaceUpDangerYield({ hurtAgoMs: 1e9, hostiles: [{ name: 'skeleton', d: 3, dy: 0 }] }), false, 'ranged has its own branch');
});

test('death #17: 危险检查并进 deadlineHit (所有主循环都查它), 触发时先解冻 self_defense/self_preservation 再退出', () => {
    const s = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    assert.match(s, /const deadlineHit = \(\) => [^\n]*_suDangerCheck && _suDangerCheck\(\)/);
    const chk = s.slice(s.indexOf('_suDangerCheck = () => {'), s.indexOf('await climbToSurface();'));
    assert.match(chk, /surfaceUpDangerYield\(/);
    assert.match(chk, /for \(const m of \['self_defense', 'self_preservation'\]\)[^\n]*bot\.modes\.setOn\(m, prevModes\[m\]\)/, 'reflexes unfrozen at once, not only in the finally');
});
