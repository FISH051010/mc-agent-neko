// ★T-0283 (10-11 06:41:56-06:43:03Z, branchMine coal_ore ×3 each a full 9s 'dig-timeout'): mineflayer computes a dig's
// duration ONCE, at bot.dig() start, and multiplies it by 5 when !bot.entity.onGround. branchMine had just dug out the
// floor and started the next dig while the body was still dropping (dig.begin y=56.536 / 55.536 / 55.92) → wooden pick on
// coal 2.25s × 5 = 11.25s > the 9s timeout: the server never got a finish packet in time, the dig was stopped, retried,
// stopped again. Not LOS / reach / stance. A dig must start on the ground; wait (bounded) for the body to land first.
export const DIG_SETTLE_MS = 1200;

export async function settleForDig(bot, { maxMs = DIG_SETTLE_MS, pollMs = 50 } = {}) {
    const e = bot && bot.entity;
    if (!e) return { waited: 0, grounded: false, skipped: 'no-entity' };
    if (e.onGround !== false) return { waited: 0, grounded: true };   // unknown (no physics) → don't stall the dig
    // floating/climbing never lands by waiting: dig as-is (mineflayer's water penalty is off; the penalty applies anyway)
    if (e.isInWater || e.isInLava || e.isOnLadder || e.isInWeb) return { waited: 0, grounded: false, skipped: 'fluid-or-climb' };
    const t0 = Date.now();
    while (!e.onGround && Date.now() - t0 < maxMs) await new Promise(r => setTimeout(r, pollMs));
    return { waited: Date.now() - t0, grounded: !!e.onGround };
}
