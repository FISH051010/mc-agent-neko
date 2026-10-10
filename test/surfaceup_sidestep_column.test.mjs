// T-0172 (worker-stuck 报, 03:17:26→03:20:39 @109,39,-69): surfaceUp fallback 'gravity column over shaft — sidestep 0,1' 反复,
// dig-gate 同格 granite@109,41,-70 拒挖 ×8 零进度。侧移在脚坐标刚跨界就松键 → 碰撞箱 (±0.3) 仍压着砂砾柱那列。
// 另: 03:21:23/35 饥饿掉血 (无怪) 触发 UNOWNED DANGER 'bunker' 打断上浮觅食。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hitboxInsideColumn } from '../bots/_supervisor/skills/surfaceUp.js';
import { unownedDangerAction } from '../src/agent/framework/mobility_signals.js';

test('T-0172: 侧移完成 = 碰撞箱整个落在新列, 不是脚坐标跨界', () => {
    const cell = { x: 109, z: -69 };
    assert.equal(hitboxInsideColumn({ x: 109.5, z: -68.95 }, cell), false, 'feet in -69 but hitbox reaches z=-69.25 → still under the -70 column');
    assert.equal(hitboxInsideColumn({ x: 109.5, z: -68.5 }, cell), true);
    assert.equal(hitboxInsideColumn({ x: 109.75, z: -68.5 }, cell), false, 'straddling x too');
});

test('T-0172: surfaceUp 侧移循环走到 hitboxInsideColumn, 同一起点第二次侧移即放弃本次上浮', () => {
    const s = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    const seg = s.slice(s.indexOf('if (gravityAboveShaft(_bt, _f0)) {'), s.indexOf('for (let h = 2; h <= 4; h++) {', s.indexOf('if (gravityAboveShaft(_bt, _f0)) {')));
    assert.match(seg, /_gravSidestepFrom\[_sk\] >= 2\)[^\n]*break;/);
    assert.match(seg, /if \(hitboxInsideColumn\(bot\.entity\.position, _cell\)\) break;/);
    assert.match(seg, /if \(!hitboxInsideColumn\(bot\.entity\.position, _cell\)\)[^\n]*break;/);
});

test('UNOWNED DANGER: 饥饿/坠落掉血且附近无怪 → 不收回控制 (救不了, 只会打断觅食); 有怪 / 溺水照旧', () => {
    const base = { unownedMs: 5000, hurtRecently: true, headInWater: false, oxygen: 20, exposed: false };
    assert.equal(unownedDangerAction({ ...base, hostileNear: false }), null, '03:21 starvation hp9→1');
    assert.equal(unownedDangerAction({ ...base, hostileNear: true }), 'bunker');
    assert.equal(unownedDangerAction({ ...base, hurtRecently: false, headInWater: true, oxygen: 5, hostileNear: false }), 'swim', 'drowning still acts');
    assert.equal(unownedDangerAction(base), 'bunker', 'default keeps old behaviour');
    assert.match(fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8'), /threshold: unownedDangerThreshold\(bot\.health\),\s*hostileNear: /, 'reflex_watchdog passes hostileNear');
});
