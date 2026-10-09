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

// Guard (b): a SAME-world bot that died naked moments ago keeps its log (still relevant).
export function shouldArchiveStaleWorld(recent) {
    if (!recent || recent.n < 1) return false;                 // nothing to contaminate
    if (recent.ageMin < 10 && recent.near) return false;
    return true;
}

export async function archiveStaleWorldStateOnSwitch(b, { sup, delayMs = 5000, now = () => Date.now() } = {}) {
    if (!isNakedFreshCharacter(b.inventory)) return null;     // has gear → same-world reconnect, never reset
    // (a) defeat inventory LOAD-LAG: a real fresh char is still naked after 5s; lag has resolved by then.
    await new Promise((r) => setTimeout(r, delayMs));
    if (!isNakedFreshCharacter(b.inventory)) return null;     // gear loaded in → was just lag, not a new world
    let recent = null;
    try {
        recent = newestDeathSummary(fs.readFileSync(sup('death_log.jsonl'), 'utf8'), b.entity && b.entity.position, now());
    } catch (e) { recent = null; }
    if (!shouldArchiveStaleWorld(recent)) return null;
    const ts = new Date(now()).toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const archived = [];
    for (const f of ['death_log.jsonl', 'landmarks.json', 'bed.json']) {
        try { if (fs.existsSync(sup(f))) { fs.renameSync(sup(f), sup(`${f}.${ts}.oldworld`)); archived.push(f); } } catch (e) {}
    }
    try {
        fs.appendFileSync(sup('progress.txt'),
            `[${new Date(now()).toISOString()}] [world-scope] ★C333 NEW-WORLD detected (naked fresh char, armor=0/tools=0; newest death ${recent.ageMin.toFixed(0)}min ago near=${recent.near}) → archived ${archived.join(',') || 'none'} (phantom-hazard reset)\n`);
    } catch (e) {}
    console.log(`🌍 C333 world-switch: archived stale coordinate state [${archived.join(',')}] — naked fresh character, old log won't poison death-zones`);
    return { archived, recent };
}

export const supIn = (dir) => (...segs) => path.join(dir, ...segs);
