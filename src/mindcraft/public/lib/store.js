// store.js — 手写 signal（约 40 行核心）+ 全局共享状态。
// 不引框架：绿色分发包不该带前端构建链，signal 这点量自己写更可控。

/**
 * 最小可用响应式单元。
 *   const s = signal(0); s.subscribe(v => ...); s.value = 1;
 * subscribe 默认立刻回调一次（渲染场景 99% 都要），传 false 可关掉。
 */
export function signal(initial) {
    let value = initial;
    const subs = new Set();
    const s = {
        get value() { return value; },
        set value(v) {
            if (Object.is(v, value)) return;
            value = v;
            for (const fn of [...subs]) {
                try { fn(value); } catch (err) { console.error('[signal] 订阅者抛错', err); }
            }
        },
        set(v) { s.value = v; },
        /** 对象型 signal 就地改后强制通知（Object.is 会拦下同引用赋值） */
        touch() { for (const fn of [...subs]) { try { fn(value); } catch (err) { console.error(err); } } },
        update(fn) { s.value = fn(value); },
        subscribe(fn, immediate = true) {
            subs.add(fn);
            if (immediate) { try { fn(value); } catch (err) { console.error(err); } }
            return () => subs.delete(fn);
        },
    };
    return s;
}

/** 订阅一组 signal，任一变化就跑 fn；返回取消函数。 */
export function effect(sources, fn) {
    const offs = sources.map(s => s.subscribe(fn, false));
    fn();
    return () => offs.forEach(off => off());
}

/** 派生只读 signal。 */
export function derived(sources, compute) {
    const out = signal(compute());
    sources.forEach(s => s.subscribe(() => { out.value = compute(); }, false));
    return out;
}

// ── 全局共享状态 ────────────────────────────────────────────────────────────
// 面板只管一个 bot（用户明确要求：不做多 agent 编排），所以这里都是单数。
export const boot = signal(null);        // GET /api/bootstrap 的结果
export const status = signal(null);      // GET /api/status 的结果
export const botState = signal(null);    // socket state-update 推来的 full_state
export const agents = signal([]);        // socket agents-status（只用于判断在线）
export const connected = signal(false);  // socket 连接状态
export const chatLog = signal([]);       // bot-output 最近若干条

/** bot 名字：优先用 bootstrap，其次 socket 里报上来的第一个。 */
export function botName() {
    return boot.value?.botName || status.value?.agent?.name || agents.value[0]?.name || '';
}
