// ★T-0091: horizontal net-progress model for the SWIM state.
//
// The old SWIM_STUCK detector re-anchored whenever the bot drifted >1 block from the anchor, so any
// oscillation wider than 1 block (swim-instinct yaw circling, back-and-forth shore hunting, current
// drift) reset the 12s timer forever — the same class of bug as the y-bob that fooled the 3D freeze
// check. And the escape reflex re-anchored after every 0.3-0.7s burst, so even once escalated the
// dedicated reflex owned the body for ~1 burst per 12s while the topology-blind instinct bobbed.
//
// Model instead: keep the last `windowMs` of horizontal samples. "No net progress" = the bot has been
// swimming for a full window AND every sample in that window lies within `radius` of the window's
// centroid (circling / bobbing / pacing all collapse to a small disc). Once stuck it LATCHES until
// the bot makes real headway (`exitDist` from the trap disc centre) — so the escape reflex keeps the body
// until it actually gets somewhere, instead of handing it back to the instinct after one burst.

export function createSwimTracker({ windowMs = 12000, radius = 2.5, exitDist = 4 } = {}) {
    let samples = [];   // {t, x, z}
    let since = 0;      // first sample of the current SWIM episode
    let latch = null;   // {x, z} centre of the trap disc SWIM_STUCK latched on

    function reset() { samples = []; since = 0; latch = null; }

    /** Feed one observation; returns true while the bot is making no horizontal net progress. */
    function observe(t, x, z) {
        if (!since) since = t;
        samples.push({ t, x, z });
        while (samples.length && samples[0].t < t - windowMs) samples.shift();

        if (latch) {
            if (Math.hypot(x - latch.x, z - latch.z) >= exitDist) {
                // real headway — start a fresh episode from here
                latch = null; samples = [{ t, x, z }]; since = t;
                return false;
            }
            return true;
        }
        if (t - since < windowMs || samples.length < 2) return false;
        let cx = 0, cz = 0;
        for (const s of samples) { cx += s.x; cz += s.z; }
        cx /= samples.length; cz /= samples.length;
        for (const s of samples) if (Math.hypot(s.x - cx, s.z - cz) > radius) return false;
        // latch on the trap disc's CENTRE: pacing across the disc (±radius) must not count as escape
        latch = { x: cx, z: cz };
        return true;
    }

    return { observe, reset, get latched() { return !!latch; } };
}

// ★C231 mobility base classification (moved verbatim from modes.js): in water → SWIM; any walkable exit
// → FREE; no exits + open above + covered (enc) → POCKET; no exits + open above + sky → FREE (exposed
// ledge); no exits + solid above → ENTOMBED.
export function mobilityBaseState({ inWater, exitsN, upOpen, enc }) {
    return inWater ? 'SWIM' : (exitsN ? 'FREE' : ((upOpen && enc) ? 'POCKET' : (upOpen ? 'FREE' : 'ENTOMBED')));
}

// One mobility tick while st==='SWIM' (moved verbatim from modes.js). holder keeps _submTrapAt/_swimTrack.
// ★T-0098 SUBMERGED-TRAP: covered water pocket (enc) for >12s → ENTOMBED (aquifer-aware dig-out) —
//   horizontal thrashing never resets it. Open water (enc=false) → T-0091 windowed SWIM_STUCK.
export function classifySwim(holder, { enc, now, x, z }) {
    if (!holder._swimTrack) holder._swimTrack = createSwimTracker();
    if (enc) {
        let st = 'SWIM';
        if (!holder._submTrapAt) holder._submTrapAt = now;
        else if (now - holder._submTrapAt > 12000) st = 'ENTOMBED';
        // fresh episode so surfacing into open water doesn't instantly SWIM_STUCK
        holder._swimTrack.reset();
        return st;
    }
    holder._submTrapAt = 0;
    // ★T-0091: windowed net-progress (all samples of the last 12s inside a 2.5b disc), latched until 4b of
    // real headway. The old ">1b from anchor → re-anchor" test was reset forever by circling / pacing.
    return holder._swimTrack.observe(now, x, z) ? 'SWIM_STUCK' : 'SWIM';
}

// ★T-0104 (moved verbatim from modes.js self_preservation SWIM entry): drowning (oxygen<=14) inside a
// covered water pocket (mobility.enclosed) with a solid non-fluid block 2 above the feet → self_preservation
// must YIELD so mobility's ENTOMBED dig-out owns the body (live 06-28 @69,48: 'heading for air' fought the
// dig-out for 26s and ate the escape window → drowned). Open water / head in water / oxygen fine → no yield.
export function sealedWaterTrapYield(bot) {
    const _drownSub = bot.oxygenLevel !== undefined && bot.oxygenLevel <= 14;
    const _subEnc = !!(bot._mobility && bot._mobility.enclosed);
    const _hCap = bot.blockAt(bot.entity.position.offset(0, 2, 0));
    const _headCapped = _hCap && _hCap.boundingBox === 'block' && !/water|lava/.test(_hCap.name || '');
    return !!(_drownSub && _subEnc && _headCapped);
}
