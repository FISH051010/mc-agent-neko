// ★C333 (T-0065): world-switch detection + stale coordinate-state archive.
// Extracted verbatim from Agent._archiveStaleWorldStateOnSwitch so the criterion can be pinned by
// test/world_scope.test.mjs (回归测试钉死). Behavior is unchanged; see the call site in agent.js's
// spawn handler for the full rationale.
import fs from 'fs';
import path from 'path';

// fresh character: no armor worn, no tool/weapon/shield, only a tiny scrap of starter blocks
export function isNakedFreshCharacter(inventory) {
    const items = (inventory ? inventory.items() : []) || [];
    const armorN = inventory ? [5, 6, 7, 8].filter(s => inventory.slots[s]).length : 0;
    const hasTool = items.some(i => /_pickaxe$|_axe$|_sword$|_shovel$|_hoe$/.test(i.name));
    const hasShield = items.some(i => i.name === 'shield') || !!(inventory && inventory.slots[45] && inventory.slots[45].name === 'shield');
    const totalItems = items.reduce((s, i) => s + (i.count || 0), 0);
    return armorN === 0 && !hasTool && !hasShield && totalItems <= 16;
}

// Summarize the newest death_log entry relative to the bot's current position. null = no usable log.
export function newestDeathSummary(deathLogText, pos, now = Date.now()) {
    const lines = String(deathLogText || '').trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    const last = JSON.parse(lines[lines.length - 1]);
    const ageMin = (now - new Date(last.ts).getTime()) / 60000;
    const near = !!(pos && typeof last.x === 'number' && Math.hypot(last.x - pos.x, last.z - pos.z) < 24);
    return { ageMin, near, n: lines.length };
}

// ★T-0065 扩展 (2026-10-09 新世界实录): 旧清单只有 death_log/landmarks/bed, 新世界开局后
// stations.json 仍留着旧世界 223 个工作台/熔炉坐标、spawn_pos/bank/migrate_state 也全是旧坐标。
// 凡是"世界局部、但全局持久化"的坐标态都在这里登记一次, 换世界时整体归档。
export const WORLD_SCOPED_FILES = [
    'death_log.jsonl', 'landmarks.json', 'bed.json',
    'stations.json', 'spawn_pos.json', 'home.json', 'death_pos.json',
    'bank.json', 'bank_ghost.json', 'migrate_state.json', 'prep_water.json', 'oak_apple_backoff.json',
];
export const WORLD_ID_FILE = 'world_id.json';

// 世界身份 = 登录包 worldState.hashedSeed (种子的 SHA-256 截断, 每个世界唯一; mineflayer 的
// game.js 不存它, 所以要从 bot._client 的原始 login 包里拿)。i64 可能是 [hi,lo] 数组或 BigInt。
export function worldIdFromLoginPacket(packet) {
    try {
        const ws = (packet && (packet.worldState || packet)) || {};
        const h = ws.hashedSeed;
        if (h === undefined || h === null) return null;
        return Array.isArray(h) ? h.join(':') : String(h);
    } catch (e) { return null; }
}

// 有可靠世界身份时以它为准: 变了=换世界(不管背包), 没变=同一世界(绝不归档)。
// 任一侧缺失 (首次部署/旧版本没记过/包里没字段) → null, 调用方退回裸装启发式。
export function decideBySeed(storedId, currentId) {
    if (!storedId || !currentId) return null;
    return storedId !== currentId;
}

// Guard (b): a SAME-world bot that died naked moments ago keeps its log (still relevant).
export function shouldArchiveStaleWorld(recent) {
    if (!recent || recent.n < 1) return false;                 // nothing to contaminate
    // ★2026-10-09 实录误判: keepInventory=false 的世界里死后裸装复活是常态, 且复活点可离死点很远
    // (这次 58 格) → 旧的 `&& recent.near` 让同一世界的 death_log/stations/landmarks 被当旧世界归档。
    // 刚死(<10min)本身就说明这份日志属于当前世界, 不再要求距离。主判据现在是 hashedSeed, 本推断只兜底首见。
    if (recent.ageMin < 10) return false;
    return true;
}

function readStoredWorldId(sup) {
    try { return JSON.parse(fs.readFileSync(sup(WORLD_ID_FILE), 'utf8').replace(/^﻿/, '')).id || null; } catch (e) { return null; }
}
function writeWorldId(sup, id, now) {
    if (!id) return;
    try { fs.writeFileSync(sup(WORLD_ID_FILE), JSON.stringify({ id, seenAt: new Date(now()).toISOString() })); } catch (e) {}
}
function archiveFiles(sup, now) {
    const ts = new Date(now()).toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const archived = [];
    for (const f of WORLD_SCOPED_FILES) {
        try { if (fs.existsSync(sup(f))) { fs.renameSync(sup(f), sup(`${f}.${ts}.oldworld`)); archived.push(f); } } catch (e) {}
    }
    return archived;
}

export async function archiveStaleWorldStateOnSwitch(b, { sup, delayMs = 5000, now = () => Date.now(), worldId = null } = {}) {
    const bySeed = decideBySeed(readStoredWorldId(sup), worldId);
    if (bySeed !== null) {
        writeWorldId(sup, worldId, now);
        if (!bySeed) return null;                               // same world (seed matches) → never reset
        const archived = archiveFiles(sup, now);
        try {
            fs.appendFileSync(sup('progress.txt'),
                `[${new Date(now()).toISOString()}] [world-scope] ★C333 NEW-WORLD by seed (hashedSeed changed → ${worldId}) → archived ${archived.join(',') || 'none'}
`);
        } catch (e) {}
        console.log(`🌍 C333 world-switch (seed changed): archived stale coordinate state [${archived.join(',')}]`);
        return { archived, recent: null, by: 'seed' };
    }
    writeWorldId(sup, worldId, now);                           // first sighting: remember it for next time
    if (!isNakedFreshCharacter(b.inventory)) return null;     // has gear → same-world reconnect, never reset
    // (a) defeat inventory LOAD-LAG: a real fresh char is still naked after 5s; lag has resolved by then.
    await new Promise((r) => setTimeout(r, delayMs));
    if (!isNakedFreshCharacter(b.inventory)) return null;     // gear loaded in → was just lag, not a new world
    let recent = null;
    try {
        recent = newestDeathSummary(fs.readFileSync(sup('death_log.jsonl'), 'utf8'), b.entity && b.entity.position, now());
    } catch (e) { recent = null; }
    if (!shouldArchiveStaleWorld(recent)) return null;
    const archived = archiveFiles(sup, now);
    try {
        fs.appendFileSync(sup('progress.txt'),
            `[${new Date(now()).toISOString()}] [world-scope] ★C333 NEW-WORLD detected (naked fresh char, armor=0/tools=0; newest death ${recent.ageMin.toFixed(0)}min ago near=${recent.near}) → archived ${archived.join(',') || 'none'} (phantom-hazard reset)\n`);
    } catch (e) {}
    console.log(`🌍 C333 world-switch: archived stale coordinate state [${archived.join(',')}] — naked fresh character, old log won't poison death-zones`);
    return { archived, recent, by: 'naked' };
}

export const supIn = (dir) => (...segs) => path.join(dir, ...segs);

// ★C344v2 (T-0071) keepInventory READ-ONLY probe: classify one server chat line answering
// '/gamerule keepInventory'. Returns {verdict:true|false|null, why} or null when the line is unrelated.
// verdict null = explicit rejection (no permission / unknown command) → UNVERIFIED, never assumed ON.
// (moved verbatim from Agent._assertKeepInventory's message listener)
export function classifyKeepInvReply(message, jsonMsg) {
    const txt = (message || '').toString();
    const key = (jsonMsg && jsonMsg.translate) || '';
    // only react to messages about THIS gamerule (avoid latching onto an unrelated /gamerule)
    const aboutKeepInv = /keepInventory/i.test(txt) || /keepInventory/i.test(JSON.stringify(jsonMsg && jsonMsg.with || ''));
    // query answer: vanilla commands.gamerule.query — "Gamerule keepInventory is currently set to: true" / 中文 "…目前为：true"
    if (aboutKeepInv && (key === 'commands.gamerule.query' || /(currently set to|目前为|当前.*为)/i.test(txt))) {
        const m = txt.match(/\b(true|false)\b\s*$/i) || txt.match(/\b(true|false)\b/i);
        if (m) return { verdict: m[1].toLowerCase() === 'true', why: key || txt.slice(0, 80) };
    }
    // explicit rejection
    if (key === 'commands.help.failed' || /(do not have permission|don't have permission|没有.*权限|无权)/i.test(txt)
        || /(Unknown or incomplete command|Unknown command|未知.*命令|命令.*无效)/i.test(txt)) {
        return { verdict: null, why: `rejected: ${(key || txt.slice(0, 80))}` };
    }
    return null;
}
