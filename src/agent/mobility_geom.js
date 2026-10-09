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

// fleeMove heading choice (moved verbatim from modes.js). dx,dz = unit vector away from the threat;
// probe(ux,uz) → {foot, head, above, water, drop}. Returns {hx, hz, needJump, found}.
export function chooseFleeHeading(dx, dz, probe) {
    let hx = dx, hz = dz, needJump = true;   // boxed-in fallback: jump + push straight
    let _found = false;
    // ★C334-A (T-0068 "逃怪缺翻越地形脱离"): 旧扇形只搜前向 ±90° 弧[0,±45,±90]——若前向被
    // 2 格墙/台地挡满(U 形角落), 5 个朝向全 head-blocked → fallback 直冲撞墙 → 被地形逼角
    // 无限 kite till dawn 甩不掉群(今日多条夜群杀死)。修: 扇形扩到【全 360°】(加 ±135°,180°),
    // 被前向逼角时能向后/绕行找到任意开口脱离, 而非撞死墙角。偏好序不变(away 方向 0/±45/±90
    // 先试, 背向 ±135/180 只在前向弧全堵=真逼角时才用——first-match 保证仅最后兜底), 故正常逃
    // 仍优先远离威胁, 只有走投无路才回绕。dry/wet 两遍+跌落守卫保留。
    const _FAN = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI];
    for (const pass = { dry: true }, arr = [true, false]; arr.length && !_found;) {
        pass.dry = arr.shift();
        for (const a of _FAN) {
            const ca = Math.cos(a), sa = Math.sin(a);
            const ux = dx * ca - dz * sa, uz = dx * sa + dz * ca;   // rotate desired heading by a
            const p = probe(ux, uz);
            // ★#1 (review-2026-07-06 坑里跳不出): step-up(p.foot=有台阶)且落脚后头顶(y2)实心 =
            //   2 格墙唇/低天花板, jump 只上 1 格必撞顶翻不过 → 原地死跳(实录被钉死跳 10s 被追死)。
            //   拒该朝向, 让扇形换向或落到凿墙出口; 平走(p.foot=false)不受影响。
            if (!p.head && !p.drop && (!pass.dry || !p.water) && !(p.foot && p.above)) { hx = ux; hz = uz; needJump = p.foot; _found = true; break; }   // head clear + no ledge (+dry) + 非2格唇 → run
        }
    }
    return { hx, hz, needJump, found: _found };
}
