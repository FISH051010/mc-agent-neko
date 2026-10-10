// T-0182 #24 (death #13 2026-10-10 00:23:44): 摔进洞穴 y5, 骷髅 6.4b 连射 hp12→4→0。self_defense 判
// ranged-unreachable-trap 让位 (接手方 mobility=FREE 不动) → 无人掌舵。契约: 被远程命中时让位方当拍
// 自己接手 —— ① 朝射手垫块挡视线; ② 挡不住沿面包屑回撤 (来路在头顶爬不回去则不算退路)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Vec3 from 'vec3';
import { losCoverCells } from '../src/agent/library/skills.js';
import { backtrackTarget } from '../src/agent/mobility_geom.js';

const key = (v) => `${v.x},${v.y},${v.z}`;
// death #13 场景: 洞底 y5 一层地面 (y4 stone), y5..9 全空 (洞穴)
const cave = (q) => ({ name: q.y <= 4 ? 'stone' : 'cave_air' });

test('T-0182 #24: 洞里被同层骷髅射 → 朝射手的相邻一列补脚/头两格挡视线', () => {
    const me = new Vec3(-8.5, 5, 36.4), sk = new Vec3(-8.5, 5, 30.0);   // 6.4b 正北
    const plan = losCoverCells(cave, me, sk);
    assert.ok(plan, 'not point-blank');
    assert.deepEqual(plan.column, { x: -9, z: 35 }, 'adjacent column toward the shooter');
    assert.deepEqual(plan.cells.map(key), ['-9,5,35', '-9,6,35'], 'feet + head height, bottom-up');
});

test('T-0182 #24: 那列已实心 → 无需垫 (cells 空); 贴脸 <1.5b → null (中间放不下, 交给近战/逃)', () => {
    const wall = (q) => ({ name: (q.y <= 4 || (q.z === 35 && q.x === -9)) ? 'stone' : 'air' });
    const me = new Vec3(-8.5, 5, 36.4);
    assert.deepEqual(losCoverCells(wall, me, new Vec3(-8.5, 5, 30)).cells, []);
    assert.equal(losCoverCells(cave, me, new Vec3(-8.5, 5, 35.5)), null);
});

test('T-0182 #24: 射手在高处 → 挡格随视线抬高; 挡格悬空 → 向下补支撑 (placeBlock 要贴面)', () => {
    const me = new Vec3(0.5, 5, 0.5);
    const high = losCoverCells(cave, me, new Vec3(0.5, 11, -5.5));   // 高 6 格, 水平 6 格
    assert.ok(high.cells.some(c => c.y >= 7), `cells rise with the line of fire: ${high.cells.map(key)}`);
    assert.equal(high.cells[0].y, Math.min(...high.cells.map(c => c.y)), 'bottom-up order');
    // 站在 1 宽的桥上, 朝射手那列下面是空的
    const bridge = (q) => ({ name: (q.y === 4 && q.x === 0 && q.z === 0) ? 'stone' : 'air' });
    const fl = losCoverCells(bridge, me, new Vec3(0.5, 5, -5.5));
    assert.deepEqual(fl.cells.map(key), ['0,3,-1', '0,4,-1', '0,5,-1', '0,6,-1'], 'up to 2 support cells under the cover');
});

test('T-0182 #24: 摔下来的来路在头顶 (y15 vs y3) 不是退路; 同层来路照用', () => {
    const me = { x: -9, y: 3, z: 33 };
    const fell = [{ x: -20, y: 15, z: 33 }, { x: -16, y: 15, z: 33 }];
    assert.equal(backtrackTarget(fell, me, { x: -2, z: 33 }), null);
    const walked = [{ x: -20, y: 4, z: 33 }, { x: -16, y: 3, z: 33 }];
    assert.deepEqual(backtrackTarget(walked, me, { x: -2, z: 33 }), { x: -16, y: 3, z: 33 });
});

test('T-0182 #24: self_defense 的 ranged-unreachable-trap 让位分支在被射时必须自己接手 (垫块 → 回撤), 不能裸 return', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const i = src.indexOf('DISENGAGE ranged-unreachable-trap mob=');
    assert.ok(i > 0);
    const branch = src.slice(i, src.indexOf('if (enemy && hasWeapon && !swarmed)', i));
    assert.match(branch, /recentlyHurt/);
    assert.match(branch, /skills\.coverFromShooter\(/);
    assert.match(branch, /sprintFlee\(agent\)/);
    assert.match(branch, /execute\(this, agent/);
});
