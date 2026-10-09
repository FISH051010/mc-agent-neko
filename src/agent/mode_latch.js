// ★T-0122: bounded mode bursts.
//
// A reflex mode runs its action through execute(), which sets mode.active=true until the action's
// promise settles. ModeController.update() skips an active mode's update() AND breaks the reflex loop at
// it ("if (mode.active) break"). So one await inside a reflex that never returns (an equip waiting on a
// server reply, a craft, a placeBlock …) latches the mode forever: its state model goes stale and every
// reflex listed after it (auto_heal, auto_eat, item_collecting, …) starves. Live 10-10 00:59:25→01:03:50:
// mobility latched after "dig retry 1 (ENTOMBED) spruce_log … Digging aborted"; bot._mobility stayed
// ENTOMBED while the bot was physically FREE, kernelDriver yielded to it, and only reflex_watchdog's
// 5-min pinned-position backstop (fired 26× historically) broke it.
//
// A mode that declares maxBurstMs promises its bursts are short; past that, the latch is released so
// the mode re-models from scratch next tick. The orphaned await is abandoned, not cancelled — acceptable
// for one-shot bursts (it can at most finish its last step late), and far better than a 5-min freeze.

/** Has this mode held its latch longer than it promised? */
export function burstLatchExpired(mode, now) {
    return !!(mode && mode.active && mode.maxBurstMs > 0 && mode.activeSince > 0 && now - mode.activeSince > mode.maxBurstMs);
}

/** Release every expired latch; onRelease(mode, heldMs) runs before the flag drops (for diagnostics). */
export function releaseExpiredLatches(modes, now, onRelease) {
    const released = [];
    for (const mode of modes || []) {
        if (!burstLatchExpired(mode, now)) continue;
        const heldMs = now - mode.activeSince;
        try { if (onRelease) onRelease(mode, heldMs); } catch (e) {}
        mode.active = false;
        mode.activeSince = 0;
        released.push(mode.name);
    }
    return released;
}
