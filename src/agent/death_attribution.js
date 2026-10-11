// ★T-0235 death_log attribution: which skill/action/supervised layer was live when the bot died.
// Pinned by test/death_attribution.test.mjs.
//
// Two handlers race at death: mineflayer emits 'death' on update_health(hp<=0) and the 'death' handler snapshots the
// live layers into bot._deathLayers (checkpoint #9: by the time the async snapshot writer ran, actions.stop() had
// already nulled them). But the vanilla server broadcasts the death CHAT message first and syncs health a tick later,
// so the chat-triggered death_log writer usually runs BEFORE that snapshot exists — and read the PREVIOUS death's
// snapshot (never cleared, never time-stamped). Only a FRESH snapshot may override the live layers.
export const DEATH_LAYERS_MAX_AGE_MS = 15000;

// captured = bot._deathLayers ({skill, supervised, action, at}); live = the layers read right now.
export function pickDeathLayers({ captured, live, now = Date.now(), maxAgeMs = DEATH_LAYERS_MAX_AGE_MS }) {
    const fresh = !!(captured && Number.isFinite(captured.at) && now - captured.at >= 0 && now - captured.at <= maxAgeMs);
    const src = fresh ? captured : {};
    return {
        action: src.action || live.action || null,
        skill: src.skill || live.skill || null,
        supervised: src.supervised || live.supervised || null,
    };
}
