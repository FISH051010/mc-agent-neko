// 诊断探针 (监工 10-10): death #17 02:37:09 先落世界出生点 (-1.5,65,-8.5), 1s 后出现在死亡点 (-34.5,34.5,-77.5) 并捡回掉落物,
// 无床无锚 → 23s 后 death #18。探针只观测: 判据 + 采样序列 + keepInventory 观测在死亡点附近时不写。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { classifyRespawn, makeRespawnProbe } from '../src/agent/respawn_probe.js';

const DEATH = { x: -34, y: 34, z: -77 }, SPAWN = { x: -1.5, y: 65, z: -8.5 };

test('respawn probe: 实录 death #17 → unexpected; 正常回出生点 / 有床 → 不报', () => {
    const odd = classifyRespawn({ deathPos: DEATH, finalPos: { x: -34.5, y: 34.5, z: -77.5 }, worldSpawn: SPAWN, bedExists: false });
    assert.equal(odd.unexpected, true);
    assert.ok(odd.distSpawn > 70);
    assert.equal(classifyRespawn({ deathPos: DEATH, finalPos: SPAWN, worldSpawn: SPAWN, bedExists: false }).unexpected, false);
    assert.equal(classifyRespawn({ deathPos: DEATH, finalPos: { x: -34, y: 34, z: -76 }, worldSpawn: SPAWN, bedExists: true }).unexpected, false, 'bed respawn is legit');
});

test('respawn probe: 3s 窗内采到瞬移包序列并写 ★UNEXPECTED; 只写日志不碰 bot 状态', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rprobe-'));
    const bot = new EventEmitter();
    bot.entity = { position: { ...DEATH } };
    bot.spawnPoint = { ...SPAWN };
    const probe = makeRespawnProbe(bot, { fs, supPath: (n) => path.join(dir, n), windowMs: 120, sampleMs: 10 });
    probe.onDeath();
    bot.entity.position = { ...SPAWN };
    probe.onSpawn();
    await new Promise(r => setTimeout(r, 30));
    bot.entity.position = { x: -34.5, y: 34.5, z: -77.5 };
    bot.emit('forcedMove');
    await new Promise(r => setTimeout(r, 160));
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'respawn_probe.jsonl'), 'utf8').trim());
    assert.equal(rec.unexpected, true);
    assert.ok(rec.seq.some(s => s.src === 'forcedMove' && s.x === -34.5), 'teleport packet captured');
    assert.ok(rec.seq[0].x === -1.5, 'first sample = world spawn');
    assert.match(fs.readFileSync(path.join(dir, 'progress.txt'), 'utf8'), /★UNEXPECTED respawn at death point/);
    assert.equal(probe.nearDeathPoint(), true, 'keepInventory observation must skip here (items picked back up)');
    assert.equal(bot.listenerCount('forcedMove'), 0, 'listener removed after the window');
});

test('respawn probe: agent.js 接线 — death/spawn 调探针; keepInventory 观测在死亡点附近跳过', () => {
    const a = fs.readFileSync(new URL('../src/agent/agent.js', import.meta.url), 'utf8');
    assert.match(a, /respawnProbe\.onSpawn\(\)/);
    assert.match(a, /respawnProbe\.onDeath\(\)/);
    assert.match(a, /if \(respawnProbe\.nearDeathPoint\(\)\) return;\s*const post = countItems\(bot\);/);
});
