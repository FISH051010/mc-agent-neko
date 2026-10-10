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

test('T-0182 C383: 击退/坠落位移不算有人掌舵 — 位移必须伴随真实驱动 (移动键/寻路目标)', async () => {
    const { effectivelyOwned } = await import('../src/agent/framework/mobility_signals.js');
    const now = 10000;
    // death #13 00:23:41-43: ctrl 全空 path 0, 被箭推了 ~2b
    const knocked = [{ t: 7000, x: -10.3, y: 4, z: 32.6, drv: false }, { t: 8000, x: -8.5, y: 5, z: 35.5, drv: false }, { t: now, x: -9, y: 5, z: 36.4, drv: false }];
    assert.equal(effectivelyOwned(knocked, now), false);
    const walking = knocked.map((q, i) => ({ ...q, drv: i === 1 }));
    assert.equal(effectivelyOwned(walking, now), true, 'really walking/pathing → owned');
    const pushingWall = [{ t: 7000, x: 0, y: 5, z: 0, drv: true }, { t: now, x: 0.1, y: 5, z: 0, drv: true }];
    assert.equal(effectivelyOwned(pushingWall, now), false, 'keys held but going nowhere (普查 #36) → not owned');
    assert.equal(effectivelyOwned([{ t: 9000, x: 0, y: 0, z: 0, drv: false }], now), true, 'window not full yet → no early verdict');
});

test('T-0182 #11: armoredSoloBrawl 让 shouldFlee 不逃 (16b 判据) ⇒ self_defense 挨打索敌半径也必须覆盖 16b', async () => {
    const { armoredSoloBrawl } = await import('../src/agent/combat_gates.js');
    const sk = { name: 'skeleton', position: new Vec3(14, 64, 0) };
    const bot = {
        entity: { position: new Vec3(0, 64, 0) }, entities: { 1: sk },
        inventory: { slots: { 5: { name: 'iron_helmet' } }, items: () => [{ name: 'stone_sword' }] },
    };
    assert.equal(armoredSoloBrawl(bot), true, 'skeleton at 14b counts as the solo brawl → shouldFlee will not flee');
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(src, /const range = recentlyHurt \? \(armoredSoloBrawl\(bot\) \? 16 : 12\) : 5;/, 'self_defense reach matches the brawl radius');
});

test('T-0182 #25: MAROONED 残血 hold 只在"等着能回血"时成立 — 回不了血又没吃的 → 必须放手让 feedUp 派发', async () => {
    const { lowHpHoldRecovers } = await import('../src/agent/framework/mobility_signals.js');
    assert.equal(lowHpHoldRecovers({ hp: 5, food: 12, hasEdible: false }), false, 'food<18, nothing to eat → hold = freeze');
    assert.equal(lowHpHoldRecovers({ hp: 5, food: 12, hasEdible: true }), true, 'auto_eat will act');
    assert.equal(lowHpHoldRecovers({ hp: 5, food: 19, hasEdible: false }), true, 'natural regen');
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const i = src.indexOf('if (!lowHpMovementProfile(bot.health).allowJump) {');
    assert.ok(i > 0);
    const hold = src.slice(i, src.indexOf('MAROONED low-hp hold hp=', i));
    assert.match(hold, /lowHpHoldRecovers\(/);
    assert.match(hold, /state: 'FREE'/);
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

test('T-0223 death #20: 地下 1 宽隧道被近战怪追 → 转身垫块堵隧道; 开阔洞穴/太近/不同层不堵', async () => {
    const { tunnelWallOffWanted } = await import('../src/agent/mobility_geom.js');
    // 东西向 1 宽矿道 (z=28 一条, 两侧 z=27/29 实心), 僵尸从西边 2.2b 追来
    const tunnel = (x, y, z) => z !== 28 || y < 13;
    const me = { x: 26.5, y: 13, z: 28.5 };
    assert.equal(tunnelWallOffWanted(tunnel, me, { x: 24.3, y: 13, z: 28.5 }), true, 'death #20 shape');
    const cave = (x, y, z) => y < 13;
    assert.equal(tunnelWallOffWanted(cave, me, { x: 24.3, y: 13, z: 28.5 }), false, 'open cave — walling one column does nothing');
    assert.equal(tunnelWallOffWanted(tunnel, me, { x: 25.6, y: 13, z: 28.5 }), false, 'too close to place between');
    assert.equal(tunnelWallOffWanted(tunnel, me, { x: 24.3, y: 15, z: 28.5 }), false, 'different level');
    const m = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const _s0 = m.indexOf('sprintFlee: async function'); const sf = m.slice(_s0, m.indexOf('// 有目标且已接近', _s0));
    assert.match(sf, /tunnelWallOffWanted\(_solid, me, _mm\.position\)[\s\S]*skills\.coverFromShooter\(bot, _mm/);
});
test('T-0226 death #22: 逃跑中被射手打中 → 先挡视线 (挡住就停跑); 射手贴脸或近战怪在追时不停下垫块', async () => {
    const { fleeCoverFirst } = await import('../src/agent/mobility_geom.js');
    assert.equal(fleeCoverFirst({ shooterDist: 4.6, meleeNear: false }), true, 'death #22 04:51:13');
    assert.equal(fleeCoverFirst({ shooterDist: 1.2, meleeNear: false }), false, 'point-blank: no room between');
    assert.equal(fleeCoverFirst({ shooterDist: 6, meleeNear: true }), false, 'a zombie chasing — do not stop');
    assert.equal(fleeCoverFirst({ shooterDist: 20, meleeNear: false }), false);
    const m = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const s = m.indexOf('sprintFlee: async function');
    const loop = m.slice(m.indexOf('const cr = this.nearestCreeper(bot, 12);', s), m.indexOf('// 有目标且已接近', s));
    const cover = loop.indexOf('skills.coverFromShooter(bot, _sh');
    assert.ok(cover > 0, 'sprintFlee tries cover');
    assert.ok(cover < loop.indexOf('tunnelWallOffWanted('), 'cover check runs before moving on');
    assert.match(loop, /if \(_cv && _cv\.covered\) break;/);
});