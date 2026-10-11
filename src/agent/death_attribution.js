// ★T-0235 death_log attribution: which skill/action/supervised layer was live when the bot died.
// Pinned by test/death_attribution.test.mjs.
//
// Two handlers race at death: mineflayer emits 'death' on update_health(hp<=0) and the 'death' handler snapshots the
// live layers into bot._deathLayers (checkpoint #9: by the time the async snapshot writer ran, actions.stop() had
// already nulled them). But the vanilla server broadcasts the death CHAT message first and syncs health a tick later,
// so the chat-triggered death_log writer usually runs BEFORE that snapshot exists — and read the PREVIOUS death's
// snapshot (never cleared, never time-stamped).
//
// A snapshot belongs to THIS death only if it was taken after the most recent (re)spawn — a fixed time window is
// wrong for chain deaths (T-0236: respawned onto the death point and was at hp4 again within 10s). The spawn handler
// also clears the snapshot, so a stale one can't survive a respawn either way.

// captured = bot._deathLayers ({skill, supervised, action, commitment, at}); live = the layers read right now;
// lastSpawnAt = time of the most recent spawn/respawn (bot._lastSpawnAt), 0/undefined if unknown.
export function pickDeathLayers({ captured, live, lastSpawnAt = 0 }) {
    const fresh = !!(captured && Number.isFinite(captured.at) && captured.at > (lastSpawnAt || 0));
    const src = fresh ? captured : {};
    return {
        action: src.action || live.action || null,
        skill: src.skill || live.skill || null,
        supervised: src.supervised || live.supervised || null,
        // ★T-0235 补: under kernelDriver supervised_skill is always 'kernel'/'ws' — the kernel commitment KIND
        // (GO_UNDERGROUND / NIGHT_DIG_ONE / MIGRATE …) is what actually says what the bot was trying to do.
        commitment: src.commitment || live.commitment || null,
    };
}
