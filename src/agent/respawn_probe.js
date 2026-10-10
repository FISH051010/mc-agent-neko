// ★respawn 诊断探针 (监工 10-10, death #17 02:37:09 异常: 先落世界出生点 -1.5,65,-8.5, 1s 后出现在死亡点
// -34.5,34.5,-77.5 并捡回掉落物, 无床无锚 → 23s 后 death #18)。只观测, 不改任何行为。
// 每次 respawn 后 3s 内采 position 序列 (含 forcedMove 包), 记 bot.spawnPoint / 世界出生点 / 死亡点距离 / bed.json;
// 终点离死亡点 <16b 且无床 → '★UNEXPECTED respawn at death point'。

export const UNEXPECTED_RESPAWN_B = 16;

/** 纯判据。deathPos/finalPos/worldSpawn: {x,y,z}|null ; bedExists: bool */
export function classifyRespawn({ deathPos, finalPos, worldSpawn, bedExists }) {
    const d = (a, b) => (a && b) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
    const distDeath = d(finalPos, deathPos);
    const distSpawn = d(finalPos, worldSpawn);
    const unexpected = distDeath !== null && distDeath < UNEXPECTED_RESPAWN_B && !bedExists;
    return { distDeath, distSpawn, unexpected };
}

const r1 = (v) => v ? { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: Math.round(v.z * 10) / 10 } : null;

/**
 * 挂探针。deps: { fs, supPath(name) } — 只写 progress.txt / respawn_probe.jsonl。
 * 返回 { onDeath(), onSpawn() } 供 agent.js 的 death/spawn 处理调用。
 */
export function makeRespawnProbe(bot, { fs, supPath, windowMs = 3000, sampleMs = 100 } = {}) {
    let deathPos = null, diedAt = 0;
    return {
        /** 现在是否站在死亡点附近 (无床) — 此时背包"没少"可能是捡回了掉落物, 不能当 keepInventory 证据。 */
        nearDeathPoint() {
            try {
                let bedExists = false;
                try { bedExists = fs.existsSync(supPath('bed.json')); } catch (e) {}
                return classifyRespawn({ deathPos, finalPos: r1(bot.entity && bot.entity.position), worldSpawn: null, bedExists }).unexpected;
            } catch (e) { return false; }
        },
        onDeath() {
            try { deathPos = r1(bot.entity && bot.entity.position); diedAt = Date.now(); } catch (e) {}
        },
        onSpawn() {
            if (!diedAt || Date.now() - diedAt > 120000) return;   // only respawns (not the first login)
            const t0 = Date.now();
            const seq = [];
            const sample = (src) => { try { seq.push({ t: Date.now() - t0, src, ...r1(bot.entity.position) }); } catch (e) {} };
            const onForced = () => sample('forcedMove');
            sample('spawn');
            try { bot.on('forcedMove', onForced); } catch (e) {}
            const iv = setInterval(() => sample('tick'), sampleMs);
            setTimeout(() => {
                clearInterval(iv);
                try { bot.removeListener('forcedMove', onForced); } catch (e) {}
                try {
                    let bedExists = false;
                    try { bedExists = fs.existsSync(supPath('bed.json')); } catch (e) {}
                    const finalPos = r1(bot.entity && bot.entity.position);
                    const worldSpawn = r1(bot.spawnPoint);
                    const c = classifyRespawn({ deathPos, finalPos, worldSpawn, bedExists });
                    // collapse the 100ms tick samples: keep forcedMove packets + every position change
                    const compact = seq.filter((s, i) => s.src !== 'tick' || i === 0
                        || s.x !== seq[i - 1].x || s.y !== seq[i - 1].y || s.z !== seq[i - 1].z);
                    const rec = { ts: new Date().toISOString(), deathPos, finalPos, worldSpawn, bedExists, ...c, diedAgoMs: t0 - diedAt, seq: compact };
                    fs.appendFileSync(supPath('respawn_probe.jsonl'), JSON.stringify(rec) + '\n');
                    if (c.unexpected) {
                        fs.appendFileSync(supPath('progress.txt'),
                            `[${rec.ts}] [respawn-probe] ★UNEXPECTED respawn at death point: final ${JSON.stringify(finalPos)} is ${c.distDeath.toFixed(1)}b from death ${JSON.stringify(deathPos)}, world spawn ${JSON.stringify(worldSpawn)} (${c.distSpawn === null ? '?' : c.distSpawn.toFixed(1)}b), no bed.json — seq ${JSON.stringify(compact.slice(0, 12))}\n`);
                    }
                } catch (e) {}
            }, windowMs);
        },
    };
}
