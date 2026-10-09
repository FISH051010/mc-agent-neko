// T-0121: 地下挖矿被 mobility 误判 MAROONED (sticky 180s), march 42 次抢挖掘槽与 branchMine 拔河
// (实录 10-10 16:47:19→16:50:19, `dig slot busy (MAROONED-climb) … heldBy=branchMine:ore-window`)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { purposefulDigActive } from '../src/agent/framework/mobility_signals.js';

const NOW = 1_000_000;

test('T-0121: branchMine 正持有挖掘槽 → 采矿心跳成立 (不得判被困)', () => {
    assert.equal(purposefulDigActive({ _bodyDigLockOwner: 'branchMine:ore-window', _bodyDigLockUntil: NOW + 3000 }, NOW), true);
    assert.equal(purposefulDigActive({ _bodyDigLockOwner: 'chopWood:dig', _bodyDigLockUntil: NOW - 10000 }, NOW), true, '15s window');
});

test('T-0121: 反射自己的挖 (mobility:/unstuck:) 不算 — march 修路不能给自己续命; 过期也不算', () => {
    assert.equal(purposefulDigActive({ _bodyDigLockOwner: 'mobility:MAROONED', _bodyDigLockUntil: NOW + 3000 }, NOW), false);
    assert.equal(purposefulDigActive({ _bodyDigLockOwner: 'unstuck:step-edge-notch', _bodyDigLockUntil: NOW + 3000 }, NOW), false);
    assert.equal(purposefulDigActive({ _bodyDigLockOwner: 'branchMine:ore-window', _bodyDigLockUntil: NOW - 20000 }, NOW), false);
    assert.equal(purposefulDigActive({}, NOW), false);
});

test('T-0121: modes.js 的 MAROONED 升级链 (含 sticky) 必须先过采矿心跳', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const i = src.indexOf('purposefulDigActive(bot, now)');
    assert.ok(i > 0, 'modes.js consults the mining heartbeat');
    const esc = src.indexOf("noPathRecent >= 3) st = 'MAROONED'", i);
    const sticky = src.indexOf("this.lastState === 'MAROONED'", i);
    const gate = src.indexOf('if (_purposefulDig) { /* mining', i);
    assert.ok(gate > i && gate < esc && esc < sticky, 'heartbeat gate precedes both the primary and the sticky MAROONED branch');
});
