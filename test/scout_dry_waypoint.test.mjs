// T-0279 (2026-10-11 06:37-06:38Z 实录): quickMeal 侦察 scoutToward (-77,-85) 紧挨湖 (-81,-87), 航点落湖面 → 寻路只能进水 → SWIM →
// self_preservation 游泳本能抢身拽回岸 → 重派再进水, 循环 (worker-death T-0277 查反射侧)。侦察侧: 航点落水面就挪到 ≤8 格内干地, 没有就跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'drywp-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
const { dryWaypoint } = await import('../bots/_supervisor/skills/quickMeal.js');

// 湖: 以 (cx,cz) 为心、半径 lakeR 的方形水面 (y=62 水, 其下沙); 其余 y=62 草方块; 63 以上空气
function lakeBot(cx, cz, lakeR, { loadedR = 1000 } = {}) {
    return {
        entity: { position: new Vec3(cx + 20, 63, cz) },
        blockAt(p) {
            if (Math.abs(p.x - cx) > loadedR || Math.abs(p.z - cz) > loadedR) return null;
            if (p.y >= 63) return { name: 'air', boundingBox: 'empty' };
            if (p.y === 62) return (Math.abs(p.x - cx) <= lakeR && Math.abs(p.z - cz) <= lakeR) ? { name: 'water', boundingBox: 'empty' } : { name: 'grass_block', boundingBox: 'block' };
            return { name: 'dirt', boundingBox: 'block' };
        },
    };
}

test('T-0279: 航点在湖面 → 挪到最近的岸 (≤8 格); 岸上的航点原样', () => {
    const bot = lakeBot(-81, -87, 4);
    const d = dryWaypoint(bot, { x: -77, z: -85 });       // 06:37Z scoutToward, 在湖边缘内
    assert.ok(d && (Math.abs(d.x + 81) > 4 || Math.abs(d.z + 87) > 4), `moved to shore: ${JSON.stringify(d)}`);
    assert.ok(Math.hypot(d.x + 77, d.z + 85) <= 8 * Math.SQRT2);
    const land = { x: -60, z: -87 };
    assert.equal(dryWaypoint(bot, land), land, 'dry waypoint untouched');
});

test('T-0279: 大湖中心 8 格内全是水 → 跳过 (null); 区块未加载 → 不判原样返回', () => {
    assert.equal(dryWaypoint(lakeBot(0, 0, 20), { x: 0, z: 0 }), null);
    const far = { x: 500, z: 500 };
    assert.equal(dryWaypoint(lakeBot(0, 0, 20, { loadedR: 100 }), far), far);
});
