// Mobility geometry moved verbatim out of modes.js so test/sealed_room.test.mjs can pin it. No behavior change.

// ★C341 (T-0074): SEALED-ROOM detection. The mobility state machine reads any adjacent walkable air as
// an `exit` → a bot boxed into a 3x3 cobble room (interior air, but EVERY wall solid, no way out) is
// mislabeled FREE → no escape reflex fires → it sits trapped forever WITH a pickaxe in the bag (用户实锤:
// claude-A 的 bunker 把她封进 3x3x2 cobble 密室). ENTOMBED only covers the 1x1 point-blank case (head
// solid); a roomy seal has air to stand in, so it never triggers. Distinguish a sealed room from genuine
// open space by a BOUNDED flood-fill of the reachable air: if the flood EXHAUSTS within a small cap (fully
// walled, no exit), it's sealed; if it spills past the cap (a tunnel to a cave / the open surface / a
// chimney to sky), it's free. No per-cell sky probe needed — any opening lets the flood escape past the
// cap. Cheap, and the caller only runs it when locally FREE/POCKET *and* covered-above (the only state
// that can BE a sealed room), so it costs ~0 in the open. Returns {sealed, cells}.
export function detectSealedRoom(bot) {
    try {
        if (!bot || !bot.entity) return { sealed: false };
        const solid = (b) => b && b.boundingBox === 'block';
        const start = bot.entity.position.floored();
        const stand = (q) => {                 // a cell the body can occupy: feet+head non-solid, non-lava
            const f = bot.blockAt(q), h = bot.blockAt(q.offset(0, 1, 0));
            if (solid(f) || solid(h)) return false;
            if (/lava/.test((f && f.name) || '') || /lava/.test((h && h.name) || '')) return false;
            return true;
        };
        if (!stand(start)) return { sealed: false };
        const CAP = 130;                       // > CAP reachable cells ⇒ "open enough", not a trap
        const seen = new Set([`${start.x},${start.y},${start.z}`]);
        const q = [start];
        let head = 0;
        while (head < q.length) {
            if (seen.size > CAP) return { sealed: false };          // flood spilled out → open
            const c = q[head++];
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
                const n = c.offset(dx, dy, dz);
                const k = `${n.x},${n.y},${n.z}`;
                if (seen.has(k)) continue;
                if (stand(n)) { seen.add(k); q.push(n); }
            }
        }
        return { sealed: true, cells: seen.size };                 // flood exhausted within cap + covered ⇒ sealed
    } catch (e) { return { sealed: false }; }
}
