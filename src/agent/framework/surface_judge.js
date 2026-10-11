// ★T-0258 地表判据唯一来源 (监工审计) — "am I on the surface?" in ONE place.
//
// Same bug three times (T-0189 food_floor/quickMeal, T-0251 replenishKit, T-0257 chopWood): each module scanned the
// blocks above the head its own way and a bot standing on the surface under a tree canopy was called "underground"
// (leaves / logs counted as a roof, or skyLight dimmed below 14 by the leaves) → pointless climbs, a pickless bot
// "boxed in stone", a forest bootstrap that never chopped. Rules:
//   · skyLight ≥14 at the head block            → surface (T-0189 skyOpenAt)
//   · a ROCK roof above the head (any solid that isn't canopy, or a fluid), within maxDy → not surface
//   · canopy (leaves, logs/wood/stems, vines, mangrove roots, azalea, bamboo) is never a roof
//   · otherwise surface iff y ≥ SURFACE_LOW_Y (a deep open pit/ravine is not the surface)
// Callers keep their own decision on top (e.g. "don't climb when already ≥ SURFACE_Y") but never hand-write a roof scan
// or a sky test again — test/surface_judge_sole_source.test.mjs pins that.
// Pure helpers take blockAt({x,y,z}); the bot wrappers read bot.entity / bot.blockAt.
import Vec3 from 'vec3';

export const SURFACE_Y = 63;        // surfaceUp's default target; "above this there is nowhere to climb to"
export const SURFACE_LOW_Y = 55;    // lowest y that can still be the open surface (valleys, beaches)
export const ROOF_SCAN_DY = 36;
export const LEGACY_SURFACE_Y = 62;   // no world data at all (no blockAt) → the old depth-only line

const CANOPY_RE = /(leaves$|_log$|_wood$|_stem$|_hyphae$|^vine$|_vines?$|_vines_plant$|^mangrove_roots$|^muddy_mangrove_roots$|azalea$|^bamboo$|^cocoa$|^moss_carpet$|^snow$)/;
const FLUID_RE = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/;

/** Tree canopy / foliage — never a roof for the surface verdict. */
export function isCanopyBlock(b) {
    return !!(b && CANOPY_RE.test(b.name || ''));
}

/** dy (2..maxDy above the feet) of the first rock roof — a non-canopy solid or a fluid — or null when there is none. */
export function rockRoofAbove(blockAt, feet, maxDy = ROOF_SCAN_DY) {
    const fx = Math.floor(feet.x), fy = Math.floor(feet.y), fz = Math.floor(feet.z);
    for (let dy = 2; dy <= maxDy; dy++) {
        let b = null;
        try { b = blockAt({ x: fx, y: fy + dy, z: fz }); } catch (e) { b = null; }
        if (!b) continue;
        const n = b.name || '';
        if (FLUID_RE.test(n)) return dy;
        if (b.boundingBox === 'block' && !isCanopyBlock(b)) return dy;
    }
    return null;
}

// Ring check (the canopy-blind successor of mobility.enclosed for this question): 8 columns SURFACE_RING_SPACING away;
//   a skylight shaft / cave hole has a rock roof over all of them (C32 y64 pin), a forest canopy over none, a hillside over a few.
export const SURFACE_RING_SPACING = 4;
export const SURFACE_RING_MIN_OPEN = 2;
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/**
 * ★T-0271 (05:44:58Z @20,62,-10: a 1-deep night pit on the spawn hillside — the neighbours' ground rose above feet+2 and the
 * old scan called that dirt a roof → ring 0 → "not surface" while surfaceUp said "already at open surface" → ① gain 0 ×3).
 * A roof over a column is solid ABOVE an air gap: walk up from feet level, skip the column's own ground (solid from below),
 * and only a non-canopy solid / fluid after air counts. Never reaching air within maxDy (inside a mountain) = roofed.
 */
export function columnRoofed(blockAt, x, feetY, z, maxDy = ROOF_SCAN_DY) {
    const fy = Math.floor(feetY);
    let seenAir = false;
    for (let dy = 0; dy <= maxDy; dy++) {
        let b = null;
        try { b = blockAt({ x, y: fy + dy, z }); } catch (e) { b = null; }
        const n = (b && b.name) || 'air';
        const solid = !!(b && b.boundingBox === 'block' && !isCanopyBlock(b));
        if (!seenAir) { if (!solid) seenAir = true; continue; }   // still in the column's own ground (or water at the surface)
        if (FLUID_RE.test(n) || solid) return true;
    }
    return !seenAir;
}
/** How many of the 8 ring columns are open (no roof above their own ground). */
export function openRingCount(blockAt, feet, spacing = SURFACE_RING_SPACING, maxDy = ROOF_SCAN_DY) {
    let n = 0;
    for (const [dx, dz] of RING) {
        if (!columnRoofed(blockAt, Math.floor(feet.x) + dx * spacing, feet.y, Math.floor(feet.z) + dz * spacing, maxDy)) n++;
    }
    return n;
}

// ★T-0265: mobility.enclosed ("cut off from the open sky — night can't reach me", also the POCKET roof test) used to be
//   a hand-written 3x3 × 36-up scan in modes.js that took ANY solid as a roof → a dense canopy made a bare bot on the grass
//   "enclosed" and every night gate (shouldNightShelter, MINE_THROUGH_NIGHT, NIGHT-BAIL, flee…) called it sheltered.
//   Same grid as before (±4, 9 columns from feet+2 to +36), but canopy is never a roof and — unlike rockRoofAbove —
//   neither is a fluid: a lake bottom stays exposed (water had boundingBox 'empty' in the old scan too).
export const ENCLOSED_GRID = [-4, 0, 4];
/** dy (2..maxDy above the feet) of the first non-canopy solid, ignoring fluids; null when there is none. */
export function solidRoofAbove(blockAt, feet, maxDy = ROOF_SCAN_DY) {
    const fx = Math.floor(feet.x), fy = Math.floor(feet.y), fz = Math.floor(feet.z);
    for (let dy = 2; dy <= maxDy; dy++) {
        let b = null;
        try { b = blockAt({ x: fx, y: fy + dy, z: fz }); } catch (e) { b = null; }
        if (b && b.boundingBox === 'block' && !isCanopyBlock(b)) return dy;
    }
    return null;
}
/** Every column of the 3x3 grid (spacing 4) has a non-canopy solid roof within maxDy. */
export function enclosedAt(blockAt, feet, maxDy = ROOF_SCAN_DY) {
    const fx = Math.floor(feet.x), fz = Math.floor(feet.z);
    for (const dx of ENCLOSED_GRID) {
        for (const dz of ENCLOSED_GRID) {
            if (solidRoofAbove(blockAt, { x: fx + dx, y: feet.y, z: fz + dz }, maxDy) == null) return false;
        }
    }
    return true;
}

/** Pure verdict. sky: true/false/null (skyOpenAt); rockRoof: number|null (rockRoofAbove), undefined = no world data; openRing: number|undefined. */
export function onSurfaceAt({ y, sky, rockRoof, openRing }) {
    if (!Number.isFinite(y)) return false;
    if (rockRoof === undefined && sky !== true) return y >= LEGACY_SURFACE_Y;   // blind: depth only
    const ringOk = openRing == null || openRing >= SURFACE_RING_MIN_OPEN;
    if (sky === true) return ringOk;
    if (rockRoof != null) return false;
    return y >= SURFACE_LOW_Y && ringOk;
}

/** ★T-0189 头顶见天: 头部方块 skyLight≥14 → true; <14 → false; 无光照数据 → null. (moved here from food_floor.js) */
export function skyOpenAt(bot) {
    try {
        const p = bot.entity.position;
        const b = bot.blockAt(p.offset ? p.offset(0, 1, 0) : { x: p.x, y: p.y + 1, z: p.z });
        if (!b || !Number.isFinite(b.skyLight)) return null;
        return b.skyLight >= 14;
    } catch (e) { return null; }
}

/** Live readings for the verdicts. */
export function surfaceReadings(bot, maxDy = ROOF_SCAN_DY) {
    const p = bot.entity.position;
    if (typeof bot.blockAt !== 'function') return { y: Math.floor(p.y), sky: null, rockRoof: undefined };
    const blockAt = (q) => bot.blockAt(new Vec3(q.x, q.y, q.z));
    const rockRoof = rockRoofAbove(blockAt, p, maxDy);
    const sky = skyOpenAt(bot);
    // the ring only matters when the centre looks open — skip 8 column scans under a rock roof
    const openRing = (rockRoof == null || sky === true) ? openRingCount(blockAt, p, SURFACE_RING_SPACING, maxDy) : undefined;
    return { y: Math.floor(p.y), sky, rockRoof, openRing };
}

/** The one "am I on the surface right now" for the live bot. */
export function onSurfaceNow(bot, maxDy = ROOF_SCAN_DY) {
    try { return onSurfaceAt(surfaceReadings(bot, maxDy)); }
    catch (e) { try { return Math.floor(bot.entity.position.y) >= LEGACY_SURFACE_Y; } catch (e2) { return false; } }
}

/** Climbing makes sense only when not on the surface AND below SURFACE_Y (a cave/overhang above it has nowhere to climb to — T-0251). */
export function shouldClimbAt(r) {
    return !onSurfaceAt(r) && Number.isFinite(r.y) && r.y < SURFACE_Y;
}
export function shouldClimbToSurface(bot, maxDy = ROOF_SCAN_DY) {
    try { return shouldClimbAt(surfaceReadings(bot, maxDy)); }
    catch (e) { try { return Math.floor(bot.entity.position.y) < LEGACY_SURFACE_Y; } catch (e2) { return false; } }
}
