// T-0278 腐肉兜底 (worker-death 提议, worker-tier 定硬条件; 2026-10-11 06:02-06:05Z 实录: food 0 两轮侦察零动物,
// 每轮 4 次 "scout away from zombie 11-15b" — 主动躲开唯一能吃的东西)。人类饿到见底会杀僵尸吃腐肉 (+4 饥饿, 80% 饥饿效果)。
// 硬条件: food≤3、不在养伤锁存 (hp 够接战)、石剑以上、单只僵尸类、16 格内无其它敌对; 吃腐肉只在 food≤3。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rotten-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
const { rottenFleshTargetOk } = await import('../src/agent/framework/food_floor.js');
const { zombieFoodTarget } = await import('../bots/_supervisor/skills/quickMeal.js');

const Z = { id: 1, name: 'zombie', dist: 12 };
const SWORD = { stone_sword: 1 };

test('T-0278: 判据 — food≤3 + 不在养伤 + 石剑以上 + 单只僵尸 → 打; 任一不满足 → 不打', () => {
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: false, counts: SWORD, target: Z, hostiles: [Z] }), true);
    assert.equal(rottenFleshTargetOk({ food: 4, healLatch: false, counts: SWORD, target: Z, hostiles: [Z] }), false, 'not starving yet');
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: true, counts: SWORD, target: Z, hostiles: [Z] }), false, 'healing (hp low) → never engage');
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: false, counts: { wooden_sword: 1 }, target: Z, hostiles: [Z] }), false, 'wooden sword too weak');
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: false, counts: {}, target: Z, hostiles: [Z] }), false, 'bare hands');
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: false, counts: SWORD, target: Z, hostiles: [Z, { id: 2, name: 'zombie', dist: 14 }] }), false, 'not a pack');
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: false, counts: SWORD, target: { id: 3, name: 'skeleton', dist: 12 }, hostiles: [] }), false, 'only zombie kinds');
    assert.equal(rottenFleshTargetOk({ food: 0, healLatch: false, counts: { iron_sword: 1 }, target: { id: 4, name: 'husk', dist: 8 }, hostiles: [{ id: 4, name: 'husk', dist: 8 }] }), true);
});

function fakeBot({ food = 0, healLatch = false, inv = SWORD, mobs = [] } = {}) {
    const me = { id: 0, name: 'Neko', position: new Vec3(0, 64, 0) };
    const entities = { 0: me };
    mobs.forEach((m, i) => { entities[i + 1] = { id: i + 1, name: m.name, type: 'hostile', position: new Vec3(m.d, 64, 0) }; });
    return { food, _healLatch: healLatch, entity: me, entities,
        inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) } };
}

test('T-0278: 侦察时 06:02Z 现场换成"有石剑"版 — 单只僵尸 12 格 → 交回僵尸当猎物 (不再 scout away); 两只/没剑/养伤 → 照躲', () => {
    const z = zombieFoodTarget(fakeBot({ mobs: [{ name: 'zombie', d: 12 }] }));
    assert.ok(z && z.name === 'zombie');
    assert.equal(zombieFoodTarget(fakeBot({ mobs: [{ name: 'zombie', d: 12 }, { name: 'skeleton', d: 15 }] })), null);
    assert.equal(zombieFoodTarget(fakeBot({ inv: {}, mobs: [{ name: 'zombie', d: 12 }] })), null, '06:02Z had no sword → still flee');
    assert.equal(zombieFoodTarget(fakeBot({ healLatch: true, mobs: [{ name: 'zombie', d: 12 }] })), null);
    assert.equal(zombieFoodTarget(fakeBot({ food: 8, mobs: [{ name: 'zombie', d: 12 }] })), null);
});

test('T-0278: quickMeal 吃的顺序 — 腐肉只在 food≤3 时才吃, 排在所有正经食物之后', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/quickMeal.js', import.meta.url), 'utf8');
    assert.ok(src.includes("(bot.food <= STARVING_FOOD && c.rotten_flesh > 0 ? 'rotten_flesh' : null)"));
    const i = src.indexOf("'rotten_flesh' : null"), j = src.indexOf("c.chicken > 0 ? 'chicken' : null");
    assert.ok(j > 0 && i > j, 'rotten flesh is the last resort');
});

test('T-0278: 打僵尸这条路真能走通 — 不给自己的猎物让路; 杀掉拿到腐肉算"打到肉"; 30 格外的僵尸不算', () => {
    // worker-tests 变异 10-11: ①yield 分支不豁免猎物本身 → 每次先等这只僵尸走开 15s 再放弃, 永远不出手; ②gotMeat 只认生肉 →
    // 打死僵尸拿到腐肉也记 'hunt yielded no meat' → 冷却; ③扫描半径 16→64 → 去追 30+ 格外的僵尸。上面三条均照绿。
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/quickMeal.js', import.meta.url), 'utf8');
    assert.match(src, /if \(hd\.action === 'yield' && !\(zombieHunt && hd\.h && hd\.h\.name === target\.name\) && /, 'the hunted zombie is not a reason to wait');
    assert.match(src, /gotMeat = rawHeld\(\) > r0 \|\| \(zombieHunt && \(inv\(\)\.rotten_flesh \|\| 0\) > rf0\);/, 'rotten flesh from the kill counts');
    assert.equal(zombieFoodTarget(fakeBot({ mobs: [{ name: 'zombie', d: 30 }] })), null, 'out of the 16b engage radius');
});
