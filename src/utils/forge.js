// Forge (FML) 登录握手支持。
//
// ★2026-09-12 用户实测：把世界从 1.21.1 Fabric 换成 1.20.1 Forge 整合包后 bot 进不去，
//   服务端在登录阶段直接踢：
//       this server has mods that require forge to be installed on the client.
//   mineflayer 是以**原版客户端**身份连的，不做 FML 握手，Forge 一律拒。
//
// 握手实录（1.20.1 / fmlNetworkVersion=3，用探针逐帧抓下来的，不是推测）：
//   1. 握手包的 serverHost 后面要缀 "\0FML3\0" —— 服务端**只看这个**判定对面是不是 Forge
//      客户端。不缀就是上面那条踢出。NMP 为此留了 client.tagHost 钩子。
//   2. 之后服务端用 vanilla 的 login_plugin_request 发一串 fml:loginwrapper 帧，
//      每帧内层是 "fml:handshake" + varint 长度 + (varint 包 id + 包体)：
//        id 5  S2CModData    mod 显示信息              → 回 ACK
//        id 1  S2CModList    mod/频道/注册表清单        → 回 C2SModListReply(id 2)
//        id 3  S2CRegistry   逐个注册表同步(本服 19 个)  → 回 ACK
//        id 4  S2CConfigData 服务端配置文件             → 回 ACK
//      ACK = C2SAcknowledge(id 99)，空包体。
//   3. C2SModListReply 原样回显服务端那三张表 —— 等价于声明「我装了一模一样的 mod」。
//      本服的 mod 全是客户端渲染/配置库(geckolib/cloth_config/yacl/verity)，不引入新方块新
//      物品，所以进去之后 minecraft-data 1.20.1 依然准确，bot 能正常干活。
//
// ⚠坑（排查时在这上面绕了一圈）：NMP 的 pluginChannels.js 自带一个 login_plugin_request
//   监听器，无条件回「这个频道我不懂」。它和我们的监听器会对同一个 messageId 各回一次，
//   服务端报 multiplayer.disconnect.unexpected_query_response —— 表现和「格式写错」一模一样，
//   极易误判成自己包编错了。这里不靠「摘掉它的监听器」解决(version=auto 时 NMP 是异步装插件
//   的，摘早了会被重新装上)，而是 prependListener 抢在它前面 + 包一层 write 把它那条空应答
//   丢掉，与监听器注册顺序无关。

import mc from 'minecraft-protocol';

// fml:handshake 的包 id
const S2C_MOD_LIST = 1;
const C2S_MOD_LIST_REPLY = 2;
const S2C_MOD_DATA = 5;
const C2S_ACKNOWLEDGE = 99;

const HANDSHAKE_CHANNEL = 'fml:handshake';
const WRAPPER_CHANNEL = 'fml:loginwrapper';

// ── 极简 FriendlyByteBuf 读写（只用得上 varint 和 utf 串）────────────────────
class Reader {
    constructor(buf) { this.buf = buf; this.off = 0; }
    varint() {
        let value = 0, shift = 0, byte;
        do {
            if (this.off >= this.buf.length) throw new Error('varint 读越界');
            byte = this.buf[this.off++];
            value |= (byte & 0x7f) << shift;
            shift += 7;
        } while (byte & 0x80);
        return value;
    }
    str() {
        const n = this.varint();
        const s = this.buf.toString('utf8', this.off, this.off + n);
        this.off += n;
        return s;
    }
}

class Writer {
    constructor() { this.bytes = []; }
    varint(v) {
        do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; this.bytes.push(b); } while (v);
        return this;
    }
    str(s) {
        const b = Buffer.from(s, 'utf8');
        this.varint(b.length);
        for (const x of b) this.bytes.push(x);
        return this;
    }
    raw(b) { for (const x of b) this.bytes.push(x); return this; }
    buffer() { return Buffer.from(this.bytes); }
}

/** 把一个 fml:handshake 包体套进 fml:loginwrapper 的信封。 */
function wrap(body) {
    return new Writer().str(HANDSHAKE_CHANNEL).varint(body.length).raw(body).buffer();
}

const ackFrame = () => wrap(new Writer().varint(C2S_ACKNOWLEDGE).buffer());

// ── 服务端探测 ───────────────────────────────────────────────────────────────
// null = 还没探测过；{ tag: null } = 探过了，不是 Forge。
let cached = null;

const NOT_FORGE = { tag: null, netVersion: 0 };

/**
 * ping 一次目标服务端，看它有没有宣告 forgeData。只在这里决定要不要缀 FML 标签 ——
 * 不能无条件缀：缀了会干扰 BungeeCord 之类按 host 字段做转发解析的代理。
 *
 * 失败(超时/拒连/世界还没起来)一律当「不是 Forge」，退回原行为；绝不因为探测失败就不连。
 */
export async function probeForge({ host, port, timeout = 4000 } = {}) {
    if (cached) return cached;
    const result = await new Promise((resolve) => {
        let done = false;
        const finish = (r) => { if (!done) { done = true; resolve(r); } };
        const timer = setTimeout(() => finish(NOT_FORGE), timeout);
        try {
            mc.ping({ host, port }, (err, res) => {
                clearTimeout(timer);
                if (err || !res) return finish(NOT_FORGE);
                const nv = res.forgeData && Number(res.forgeData.fmlNetworkVersion);
                if (!nv || !Number.isFinite(nv)) return finish(NOT_FORGE);
                return finish({ tag: '\0FML' + nv + '\0', netVersion: nv });
            });
        } catch (e) {
            clearTimeout(timer);
            finish(NOT_FORGE);
        }
    });
    cached = result;
    if (result.tag) {
        console.log(`🔧 检测到 Forge 服务端（FML 网络版本 ${result.netVersion}），已启用 FML 登录握手。`);
    }
    return result;
}

/** 探测结果：目标服务端是不是 Forge。给「该建议装哪个模组」这类提示用。 */
export function isForgeServer() { return !!(cached && cached.tag); }

/** 重连时重探（用户中途换了服务端平台，缓存就过期了）。 */
export function resetForgeProbe() { cached = null; }

/**
 * 给一个刚 createBot 出来的 bot 装上 FML 握手。探测结果不是 Forge 就什么都不做。
 * 必须在 createBot 之后**同步**调用 —— tagHost 是写 set_protocol 时才读的，赶得上。
 */
export function attachForgeHandshake(bot) {
    if (!cached || !cached.tag) return false;
    const client = bot && bot._client;
    if (!client) return false;

    client.tagHost = cached.tag;

    // 我们已经应答过的 messageId。NMP 默认监听器随后会对同一个 id 再回一条空应答，
    // 在 write 这层丢掉它 —— 不依赖监听器注册顺序，version=auto 异步装插件也稳。
    const answered = new Set();
    const rawWrite = client.write.bind(client);
    client.write = function (name, params) {
        if (name === 'login_plugin_response' && params && answered.has(params.messageId)
            && !(params.data && params.data.length)) {
            return undefined;
        }
        return rawWrite(name, params);
    };

    let acked = 0;
    client.prependListener('login_plugin_request', (packet) => {
        try {
            if (packet.channel !== WRAPPER_CHANNEL) return;   // 不是 FML 的，交回默认处理

            const r = new Reader(packet.data);
            const inner = r.str();
            const len = r.varint();
            const body = packet.data.slice(r.off, r.off + len);
            if (inner !== HANDSHAKE_CHANNEL) return;

            const br = new Reader(body);
            const id = br.varint();
            let reply;

            if (id === S2C_MOD_LIST) {
                const mods = [];
                for (let i = 0, n = br.varint(); i < n; i++) mods.push(br.str());
                const channels = [];
                for (let i = 0, n = br.varint(); i < n; i++) channels.push([br.str(), br.str()]);
                const regs = [];
                for (let i = 0, n = br.varint(); i < n; i++) regs.push(br.str());

                // 注册表在**回包**里是 (名字, 版本) 对，而服务端发来的 S2CModList 里只有名字
                // —— 两个方向的格式本来就不对称，别照抄。
                const w = new Writer().varint(C2S_MOD_LIST_REPLY);
                w.varint(mods.length); for (const m of mods) w.str(m);
                w.varint(channels.length); for (const [k, v] of channels) { w.str(k); w.str(v); }
                w.varint(regs.length); for (const k of regs) { w.str(k); w.str(''); }
                reply = wrap(w.buffer());
                console.log(`🔧 FML 握手：服务端 mod ${mods.length} 个 / 频道 ${channels.length} 个 / 注册表 ${regs.length} 个，已回复 mod 清单。`);
            } else if (id === S2C_MOD_DATA) {
                reply = ackFrame();
            } else {
                acked++;
                reply = ackFrame();
            }

            answered.add(packet.messageId);
            rawWrite('login_plugin_response', { messageId: packet.messageId, data: reply });
        } catch (err) {
            // 解析不出来就让默认处理接手（回「不懂」）：至少能换来一条明确的服务端踢出理由，
            // 而不是卡在登录里静默等死。
            console.warn(`🔧 FML 握手帧解析失败（messageId=${packet && packet.messageId}）：${err.message}`);
        }
    });

    // ★整合包必踩：服务端往 minecraft:command_argument_type 里塞了自定义参数类型，NMP 的
    //   1.20.1 declare_commands 解析器不认识 → protodef 抛 PartialReadError。
    //   打印它的不是 mineflayer 也不是 NMP，而是 protodef 的 FullPacketParser._transform：
    //   遇到 partialReadError 就 console.log(e.stack) 然后 cb() 把包静默丢掉 —— **压根不发
    //   error 事件**，所以 bot.on('error') / client.on('error') 都接不到，只能在这一层关。
    //   它的开关是 parser 上的 noErrorLogging（NMP 由 client.hideErrors 喂），但 hideErrors
    //   还会连带静音解压损坏诊断(client.js:230)，太宽 —— 所以只翻 deserializer 那一个字段。
    //   deserializer 每次换协议状态都会重建(setSerializer)，包一层才保证 play 状态也生效。
    const rawSetSerializer = client.setSerializer.bind(client);
    client.setSerializer = function (state) {
        rawSetSerializer(state);
        try { if (client.deserializer) client.deserializer.noErrorLogging = true; } catch (e) {}
    };
    try { if (client.deserializer) client.deserializer.noErrorLogging = true; } catch (e) {}
    console.log('🔧 已静音 protodef 的「包解析不全」栈打印：整合包会带 NMP 不认识的自定义命令'
        + '参数类型，declare_commands 解不开是预期的。bot 不用服务端命令树，移动/挖掘/聊天均正常。');

    client.once('login', () => {
        console.log(`🔧 FML 握手完成（共应答 ${answered.size} 帧，其中注册表/配置 ${acked} 帧）。`);
    });

    return true;
}


