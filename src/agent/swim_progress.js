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
