// ★T-0234 (death 22:59:46, 反射全程沉默): 两个 surfaceUp 实例重叠 (22:57:01 孤儿 + 22:59:19 新入), 各自"记原值→关→finally 恢复"。
// 后入者把已被冻结的 off 记成原值; 先退出的恢复 on, 后退出的又恢复 off → self_defense/self_preservation 永久关着,
// 骷髅贴脸 0.2m 3s 无人出手。同一写法在 surfaceUp / bunker / skills×3 / achieve 共 6 处, 交错任意两处都会出事。
// 共享原语: 按 mode 引用计数 (登记表挂 bot._modeFreeze, 不挂模块 → 热加载/多实例共享):
//   acquire: 计数 0→1 时记原值并关; 之后只加计数。release: 计数归零才恢复原值。
//   unfreeze(m): 立即恢复 m 并清零计数 (遇险把身体还给反射; 其他持有者稍后 release 时跳过它)。
//   陈旧: 计数>0 且首冻超过 staleMs → 视为孤儿, 下次 acquire 先恢复原值再重来。
export function acquireModeFreeze(bot, names, { now = Date.now(), staleMs = 300000 } = {}) {
    const modes = bot && bot.modes;
    const prev = {};
    const held = [];
    const setOn = (m, v) => { try { modes.setOn(m, v); } catch (e) {} };
    if (modes) {
        const reg = bot._modeFreeze || (bot._modeFreeze = {});
        for (const m of names || []) {
            try { if (!(modes.exists && modes.exists(m))) continue; } catch (e) { continue; }
            let e = reg[m];
            if (e && e.count > 0 && now - (e.at || 0) > staleMs) { setOn(m, e.prev); e = null; }
            if (!e || e.count <= 0) {
                let was = true;
                try { was = modes.isOn(m); } catch (er) {}
                e = reg[m] = { count: 0, prev: was, at: now };
                setOn(m, false);
            }
            e.count++;
            held.push(m);
            prev[m] = e.prev;
        }
    }
    let released = false;
    return {
        prev,                                   // original on/off per frozen mode (read-only view)
        held,
        unfreeze(m) {
            const i = held.indexOf(m);
            if (i < 0) return;
            held.splice(i, 1);
            delete prev[m];
            const e = bot._modeFreeze && bot._modeFreeze[m];
            if (e && e.count > 0) { setOn(m, e.prev); e.count = 0; }
        },
        release() {
            if (released) return;
            released = true;
            for (const m of held) {
                const e = bot._modeFreeze && bot._modeFreeze[m];
                if (!e || e.count <= 0) continue;
                e.count--;
                if (e.count === 0) setOn(m, e.prev);
            }
            held.length = 0;
        },
    };
}
