// views/overview.js — 概览页：一眼看清「它活着吗、它在看什么、它在干什么」。
//
// 数据有两条腿：
//   1. socket 的 state-update（full_state，约 10Hz）—— 主力，这里节流到 ~400ms 渲染
//   2. GET /api/status 的 state 字段 —— socket 断了或后端没接上时兜底（app.js 在轮询）
// 视角画面轮询 GET /api/screenshot/latest.jpg；连续失败会自动放慢，避免刷屏 404。

import { post, bust, toast, toastError, ApiError } from '../lib/api.js';
import { sendChat, emit } from '../lib/socket.js';
import { botState, status, agents, connected, chatLog, botName } from '../lib/store.js';
import { html, render, onAct, icons, qs, busy } from '../lib/dom.js';

export const meta = { title: '概览', desc: 'Bot 的实时状态' };

// ── 中文化字典 ──────────────────────────────────────────────────────────────
const DIMENSION = {
    overworld: '主世界', the_overworld: '主世界',
    the_nether: '下界', nether: '下界',
    the_end: '末地', end: '末地',
};
const TIME_LABEL = { Morning: '上午', Afternoon: '下午', Night: '夜晚' };
const WEATHER = { Clear: '晴朗', Rain: '下雨', Thunderstorm: '雷暴' };
const GAMEMODE = { survival: '生存', creative: '创造', adventure: '冒险', spectator: '旁观' };
const ACTION = { Idle: '空闲中', Dead: '已死亡', Unknown: '未知' };

const BIOME = {
    plains: '平原', forest: '森林', birch_forest: '白桦林', dark_forest: '黑森林',
    taiga: '针叶林', snowy_taiga: '雪原针叶林', desert: '沙漠', savanna: '热带草原',
    jungle: '丛林', swamp: '沼泽', mangrove_swamp: '红树林沼泽', beach: '沙滩',
    ocean: '海洋', deep_ocean: '深海', river: '河流', frozen_river: '冻河',
    snowy_plains: '雪原', ice_spikes: '冰刺之地', mushroom_fields: '蘑菇岛',
    windswept_hills: '风袭丘陵', meadow: '草甸', grove: '雪林', jagged_peaks: '尖峭山峰',
    stony_peaks: '裸岩山峰', frozen_peaks: '冰封山峰', cherry_grove: '樱花林',
    dripstone_caves: '溶洞', lush_caves: '繁茂洞穴', deep_dark: '深暗之域',
    nether_wastes: '下界荒地', soul_sand_valley: '灵魂沙峡谷', crimson_forest: '绯红森林',
    warped_forest: '诡异森林', basalt_deltas: '玄武岩三角洲',
    the_end: '末地', end_barrens: '末地荒地', end_highlands: '末地高地',
};

// 背包里最常见的一批物品；查不到就退回英文名（美化下划线）。
const ITEM = {
    oak_log: '橡木原木', birch_log: '白桦原木', spruce_log: '云杉原木', jungle_log: '丛林原木',
    acacia_log: '金合欢原木', dark_oak_log: '深色橡木原木', cherry_log: '樱花原木',
    oak_planks: '橡木板', birch_planks: '白桦木板', spruce_planks: '云杉木板',
    stick: '木棍', crafting_table: '工作台', furnace: '熔炉', chest: '箱子', torch: '火把',
    cobblestone: '圆石', stone: '石头', dirt: '泥土', sand: '沙子', gravel: '砂砾',
    coal: '煤炭', charcoal: '木炭', raw_iron: '粗铁', iron_ingot: '铁锭',
    raw_gold: '粗金', gold_ingot: '金锭', diamond: '钻石', emerald: '绿宝石',
    redstone: '红石', lapis_lazuli: '青金石', quartz: '石英', obsidian: '黑曜石',
    wooden_pickaxe: '木镐', stone_pickaxe: '石镐', iron_pickaxe: '铁镐',
    diamond_pickaxe: '钻石镐', netherite_pickaxe: '下界合金镐', golden_pickaxe: '金镐',
    wooden_axe: '木斧', stone_axe: '石斧', iron_axe: '铁斧', diamond_axe: '钻石斧',
    wooden_sword: '木剑', stone_sword: '石剑', iron_sword: '铁剑', diamond_sword: '钻石剑',
    netherite_sword: '下界合金剑',
    wooden_shovel: '木锹', stone_shovel: '石锹', iron_shovel: '铁锹', diamond_shovel: '钻石锹',
    wooden_hoe: '木锄', stone_hoe: '石锄', iron_hoe: '铁锄',
    iron_helmet: '铁头盔', iron_chestplate: '铁胸甲', iron_leggings: '铁护腿', iron_boots: '铁靴子',
    diamond_helmet: '钻石头盔', diamond_chestplate: '钻石胸甲', diamond_leggings: '钻石护腿',
    diamond_boots: '钻石靴子', leather_helmet: '皮革帽子', leather_chestplate: '皮革外衣',
    shield: '盾牌', bow: '弓', arrow: '箭', bucket: '桶', water_bucket: '水桶', lava_bucket: '岩浆桶',
    bread: '面包', apple: '苹果', golden_apple: '金苹果', wheat: '小麦', wheat_seeds: '小麦种子',
    beef: '生牛肉', cooked_beef: '牛排', porkchop: '生猪排', cooked_porkchop: '熟猪排',
    chicken: '生鸡肉', cooked_chicken: '熟鸡肉', mutton: '生羊肉', cooked_mutton: '熟羊肉',
    cod: '鳕鱼', salmon: '鲑鱼', carrot: '胡萝卜', potato: '马铃薯', baked_potato: '烤马铃薯',
    white_bed: '白色床', red_bed: '红色床', bed: '床',
    string: '线', feather: '羽毛', leather: '皮革', bone: '骨头', gunpowder: '火药',
    rotten_flesh: '腐肉', spider_eye: '蜘蛛眼', ender_pearl: '末影珍珠', blaze_rod: '烈焰棒',
    flint: '燧石', clay_ball: '黏土球', paper: '纸', book: '书', glass: '玻璃',
    ladder: '梯子', scaffolding: '脚手架', cobblestone_stairs: '圆石楼梯',
    iron_nugget: '铁粒', bowl: '碗', shears: '剪刀', flint_and_steel: '打火石',
};

const ENTITY = {
    zombie: '僵尸', skeleton: '骷髅', creeper: '苦力怕', spider: '蜘蛛', cave_spider: '洞穴蜘蛛',
    enderman: '末影人', witch: '女巫', slime: '史莱姆', drowned: '溺尸', husk: '尸壳',
    phantom: '幻翼', pillager: '掠夺者', zombified_piglin: '僵尸猪灵', piglin: '猪灵',
    blaze: '烈焰人', ghast: '恶魂', magma_cube: '岩浆怪', wither_skeleton: '凋灵骷髅',
    cow: '牛', pig: '猪', sheep: '羊', chicken: '鸡', horse: '马', wolf: '狼', cat: '猫',
    villager: '村民', bat: '蝙蝠', squid: '鱿鱼', rabbit: '兔子', fox: '狐狸', bee: '蜜蜂',
    armor_stand: '盔甲架', item_frame: '物品展示框', boat: '船', minecart: '矿车',
};

const BLOCK_SHORT = { air: '空气', cave_air: '空气', water: '水', lava: '岩浆', unknown: '未知' };

const pretty = (n) => String(n || '').replace(/^minecraft:/, '').replace(/_/g, ' ');
const zhItem = (n) => ITEM[String(n || '').replace(/^minecraft:/, '')] || pretty(n);
const zhEntity = (n) => ENTITY[String(n || '').replace(/^minecraft:/, '')] || pretty(n);
const zhBiome = (n) => BIOME[String(n || '').replace(/^minecraft:/, '')] || pretty(n) || '未知';
const zhBlock = (n) => BLOCK_SHORT[n] || ITEM[n] || pretty(n) || '未知';

/** 游戏内刻 → HH:MM（0 tick = 早上 6 点） */
function gameClock(ticks) {
    const t = ((Number(ticks) || 0) % 24000 + 24000) % 24000;
    const total = (t / 1000 + 6) % 24;
    const hh = Math.floor(total);
    const mm = Math.floor((total - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function actionText(st) {
    const cur = st?.action?.current;
    if (!cur) return '未知';
    if (ACTION[cur]) return ACTION[cur];
    return cur;
}

// ── 页面骨架 ────────────────────────────────────────────────────────────────
function shell() {
    return html`
    <div class="page-head">
        <div class="page-title">概览</div>
        <div class="page-desc">Bot 现在的状态、它眼前的画面，以及你和它说话的地方。</div>
    </div>

    <div id="hero"></div>

    <div class="overview-top mt-4">
        <div class="card flush">
            <div class="pov" id="pov">
                <div class="pov-empty">
                    <span>${icons.camera}</span>
                    <span>视觉未就绪</span>
                    <span class="tiny">Bot 进入游戏后会自动出现画面</span>
                </div>
            </div>
            <div class="card-body">
                <div class="row between wrap">
                    <span class="card-title">Bot 视角</span>
                    <span class="small muted" id="povInfo">等待画面…</span>
                </div>
            </div>
        </div>

        <div class="col">
            <div class="card" id="vitals"></div>
            <div class="card" id="doing"></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">背包 <span class="hint" id="invHint"></span></div>
        <div class="card" id="inventory"></div>
    </div>

    <div class="section">
        <div class="section-title">周围情况</div>
        <div class="card" id="around"></div>
    </div>

    <div class="section">
        <div class="section-title">和它说话</div>
        <div class="card">
            <div class="chat-log" id="chatLog"></div>
            <div class="row mt-3">
                <input class="input grow" id="chatInput" type="text" maxlength="400"
                       placeholder="想让它做什么？例如：帮我砍点木头" autocomplete="off">
                <button class="btn primary" data-act="send">${icons.send} 发送</button>
            </div>
            <div class="row wrap mt-3">
                <span class="small muted">快捷指令：</span>
                <button class="btn sm" data-act="quick" data-cmd="!stop">停下</button>
                <button class="btn sm" data-act="quick" data-cmd="!standby">待命</button>
                <button class="btn sm" data-act="quick" data-cmd="!inventory">看看背包</button>
                <button class="btn sm" data-act="quick" data-cmd="!stats">报告状态</button>
            </div>
        </div>
    </div>`;
}

// ── 各区块渲染 ──────────────────────────────────────────────────────────────
function renderHero(root) {
    const st = botState.value;
    const s = status.value;
    const online = !!(st && !st.isDead) && (s ? s.inGame !== false : true);
    const anyAgent = agents.value.some(a => a.in_game);
    const running = s ? !!s.running : (anyAgent || !!st);

    let cls = 'offline', title = 'Bot 没有在运行', sub = '点右边的「启动 Bot」把它拉起来';
    if (st?.isDead) { cls = 'pending'; title = 'Bot 死亡了'; sub = '它会自动重生并继续之前的事'; }
    else if (online || anyAgent) { cls = 'online'; title = 'Bot 在线，正在游戏里'; sub = actionText(st) === '空闲中' ? '当前空闲，等你发号施令' : `正在：${actionText(st)}`; }
    else if (running) { cls = 'pending'; title = 'Bot 正在连接游戏…'; sub = '如果一直卡在这里，检查「游戏连接」页的地址和端口'; }

    if (s && s.keysReady === false) { cls = 'pending'; title = '还没配置 AI 密钥'; sub = '去「AI 配置」页填一个密钥，Bot 才能思考'; }

    const lamp = cls === 'online' ? icons.check : cls === 'pending' ? icons.alert : icons.plug;
    render(root, html`
        <div class="status-hero ${cls}">
            <span class="lamp">${lamp}</span>
            <span class="grow">
                <div class="st-main">${title}</div>
                <div class="st-sub">${sub}</div>
            </span>
            <span class="btn-group">
                <button class="btn primary" data-act="start" ${running ? 'disabled' : ''}>${icons.play} 启动 Bot</button>
                <button class="btn" data-act="restart" ${running ? '' : 'disabled'}>${icons.restart} 重启</button>
                <button class="btn danger" data-act="stop" ${running ? '' : 'disabled'}>${icons.stop} 停止</button>
            </span>
        </div>`);
}

function renderVitals(root) {
    const st = botState.value;
    if (!st) {
        render(root, html`<div class="empty">${icons.cube}<span>还没有收到 Bot 的状态</span></div>`);
        return;
    }
    const g = st.gameplay || {};
    const hp = Math.max(0, Math.min(20, Number(g.health) || 0));
    const food = Math.max(0, Math.min(20, Number(g.hunger) || 0));
    const p = g.position || {};
    render(root, html`
        <div class="card-head"><span class="card-title">身体状况</span></div>
        <div class="col">
            <div class="meter">
                <div class="meter-top"><span>生命</span><span class="mono">${hp} / 20</span></div>
                <div class="meter-bar"><div class="meter-fill hp ${hp <= 6 ? 'low' : ''}" style="width:${hp / 20 * 100}%"></div></div>
            </div>
            <div class="meter">
                <div class="meter-top"><span>饱食度</span><span class="mono">${food} / 20</span></div>
                <div class="meter-bar"><div class="meter-fill food" style="width:${food / 20 * 100}%"></div></div>
            </div>
        </div>
        <hr class="divider">
        <div class="kv">
            <div class="kv-item"><div class="kv-k">坐标</div>
                <div class="kv-v mono">${Math.round(p.x ?? 0)}, ${Math.round(p.y ?? 0)}, ${Math.round(p.z ?? 0)}</div></div>
            <div class="kv-item"><div class="kv-k">维度</div>
                <div class="kv-v">${DIMENSION[g.dimension] || pretty(g.dimension) || '未知'}</div></div>
            <div class="kv-item"><div class="kv-k">生物群系</div><div class="kv-v">${zhBiome(g.biome)}</div></div>
            <div class="kv-item"><div class="kv-k">游戏内时间</div>
                <div class="kv-v mono">${gameClock(g.timeOfDay)} <span class="small muted">${TIME_LABEL[g.timeLabel] || ''}</span></div></div>
            <div class="kv-item"><div class="kv-k">天气</div><div class="kv-v">${WEATHER[g.weather] || g.weather || '未知'}</div></div>
            <div class="kv-item"><div class="kv-k">游戏模式</div><div class="kv-v">${GAMEMODE[g.gamemode] || pretty(g.gamemode) || '未知'}</div></div>
        </div>`);
}

// 自动行为的中文名。表里没有的直接显示原名（新增 mode 不会因此消失）。
const MODE_LABEL = {
    self_preservation: '自保', unstuck: '脱困', cowardice: '遇敌逃跑',
    self_defense: '自卫反击', heading_tracker: '朝向跟踪', threat_radar: '威胁雷达',
    reflex_watchdog: '反射看门狗', mobility: '机动', mine_motion_audit: '挖掘动作审计',
    act_trace: '动作追踪', motion_quality: '移动质量', edge_unstick: '边缘脱困',
    pf_dig_watchdog: '寻路挖掘看门狗', world_model: '世界模型', bare_stone_alarm: '裸岩告警',
    tool_keeper: '工具管理', hunting: '狩猎', auto_eat: '自动进食',
    item_collecting: '自动捡拾', torch_placing: '自动放火把', elbow_room: '腾挪空间',
    idle_staring: '发呆张望', cheat: '作弊指令',
};

/**
 * 把 full_state 的 modes.summary 正规化成 [{name, on}]。
 *
 * ★2026-09-07 修 `modes.map is not a function`：
 *   full_state.js 写的是 `bot.modes?.getMiniDocs() || []`，那个 `|| []` 让人以为是数组，
 *   但 getMiniDocs() 实际返回的是**一整个字符串**：
 *       "Agent Modes:" 换行 "- self_preservation(ON)" 换行 "- unstuck(ON)" …（一整个字符串）
 *   字符串有 .length（真值）却没有 .map → 进了 modes.map 那一支直接 TypeError，整页崩。
 *   这里两种形状都吃，将来哪天上游真改成数组也不会再炸。
 */
function normalizeModes(summary) {
    if (!summary) return [];
    const lines = Array.isArray(summary) ? summary : String(summary).split(/\r?\n/);
    const out = [];
    for (const raw of lines) {
        const line = String(raw).trim();
        if (!line || /^Agent Modes:?$/i.test(line)) continue;
        // "- self_preservation(ON)" / "self_preservation(ON): 描述"
        const m = line.match(/^-?\s*([A-Za-z0-9_]+)\s*\((ON|OFF)\)/i);
        if (m) out.push({ name: m[1], on: m[2].toUpperCase() === 'ON' });
        else out.push({ name: line.replace(/^-\s*/, ''), on: null });
    }
    return out;
}

function renderDoing(root) {
    const st = botState.value;
    const modes = normalizeModes(st?.modes?.summary);
    const on = modes.filter(m => m.on !== false);
    render(root, html`
        <div class="card-head">
            <span class="card-title">当前在做什么</span>
            ${modes.length ? html`<span class="small muted">${on.length}/${modes.length} 项自动行为开启</span>` : ''}
        </div>
        <div class="st-main" style="font-size:var(--fs-lg)">${actionText(st)}</div>
        ${modes.length
            ? html`<div class="row wrap mt-3">${modes.map(m => html`
                <span class="badge ${m.on === false ? 'plain' : 'ok'}" title="${m.name}">
                    ${MODE_LABEL[m.name] || m.name}
                </span>`)}</div>`
            : html`<p class="field-help mt-2">Bot 的自动行为（躲怪、吃东西等）状态会显示在这里。</p>`}`);
}

function renderInventory(root, hintEl) {
    const st = botState.value;
    const inv = st?.inventory || {};
    const counts = inv.counts || {};
    const eq = inv.equipment || {};
    // 图标代理路由是 /assets/item/:agent/:name.png，agent 段只用来查该 bot 的游戏版本，
    // 查不到会退回 1.21.8。名字还没拿到时给个占位，别让路径出现空段导致整段 404。
    const name = botName() || 'bot';
    const entries = Object.entries(counts).filter(([, c]) => Number(c) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]));

    if (hintEl) {
        hintEl.textContent = inv.totalSlots
            ? `已用 ${inv.stacksUsed || 0} / ${inv.totalSlots} 格`
            : '';
    }

    // 图标走 mindserver 的本地代理 /assets/item/<agent>/<item>.png（内部用
    // minecraft-assets 解析 items/blocks 两个目录）。取不到就退回文字，绝不留空框。
    const slot = (itemName, qty) => html`
        <div class="inv-slot" title="${zhItem(itemName)}（${pretty(itemName)}）× ${qty}">
            <img src="/assets/item/${encodeURIComponent(name)}/${encodeURIComponent(itemName)}.png"
                 alt="${zhItem(itemName)}" loading="lazy"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <span class="txt" style="display:none">${zhItem(itemName)}</span>
            <span class="qty">${qty}</span>
        </div>`;

    const equipList = [
        ['头盔', eq.helmet], ['胸甲', eq.chestplate], ['护腿', eq.leggings],
        ['靴子', eq.boots], ['手持', eq.mainHand],
    ];

    render(root, html`
        <div class="row wrap between">
            <span class="card-title">装备</span>
        </div>
        <div class="equip-row mt-2">
            ${equipList.map(([label, item]) => item
                ? html`<div class="inv-slot equip-slot" title="${label}：${zhItem(item)}">
                        <img src="/assets/item/${encodeURIComponent(name)}/${encodeURIComponent(item)}.png"
                             alt="${zhItem(item)}" loading="lazy"
                             onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                        <span class="txt" style="display:none">${zhItem(item)}</span>
                       </div>`
                : html`<div class="inv-slot equip-slot empty" title="${label}：没有"><span class="txt">${label}</span></div>`)}
        </div>
        <hr class="divider">
        ${entries.length
            ? html`<div class="inv-grid">${entries.map(([k, v]) => slot(k, v))}</div>`
            : html`<div class="empty">${icons.cube}<span>背包是空的</span></div>`}`);
}

function renderAround(root) {
    const st = botState.value;
    const sur = st?.surroundings || {};
    const near = st?.nearby || {};
    const players = near.humanPlayers || [];
    const ents = near.entityTypes || [];
    render(root, html`
        <div class="kv">
            <div class="kv-item"><div class="kv-k">脚下</div><div class="kv-v">${zhBlock(sur.below)}</div></div>
            <div class="kv-item"><div class="kv-k">身处</div><div class="kv-v">${zhBlock(sur.legs)}</div></div>
            <div class="kv-item"><div class="kv-k">头顶</div><div class="kv-v">${zhBlock(sur.head)}</div></div>
        </div>
        <hr class="divider">
        <div class="field">
            <div class="field-label">附近的玩家</div>
            <div class="row wrap">
                ${players.length
                    ? players.map(p => html`<span class="badge info">${p}</span>`)
                    : html`<span class="small muted">附近没有其他玩家</span>`}
            </div>
        </div>
        <div class="field">
            <div class="field-label">附近的生物</div>
            <div class="row wrap">
                ${ents.length
                    ? ents.slice(0, 24).map(e => html`<span class="badge">${zhEntity(e)}</span>`)
                    : html`<span class="small muted">周围很安静</span>`}
            </div>
        </div>`);
}

function renderChat(root) {
    const lines = chatLog.value;
    if (!lines.length) {
        render(root, html`<div class="empty"><span>还没有对话。发一句试试，比如「跟着我」。</span></div>`);
        return;
    }
    const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 40;
    render(root, html`${lines.slice(-80).map(l => html`
        <div class="chat-line">
            <span class="chat-who ${l.who === '我' ? 'me' : ''}">${l.who}</span>
            <span class="chat-text">${l.text}</span>
        </div>`)}`);
    if (atBottom) root.scrollTop = root.scrollHeight;
}

// ── 视角画面轮询 ────────────────────────────────────────────────────────────
function startPov(container, infoEl) {
    let alive = true;
    let fails = 0;
    let timer = null;
    let imgEl = null;

    const showPlaceholder = (why) => {
        if (imgEl) { imgEl.remove(); imgEl = null; }
        render(container, html`
            <div class="pov-empty">
                <span>${icons.camera}</span>
                <span>视觉未就绪</span>
                <span class="tiny">${why}</span>
            </div>`);
    };

    const tick = () => {
        if (!alive) return;
        const probe = new Image();
        probe.onload = () => {
            if (!alive) return;
            fails = 0;
            if (!imgEl) {
                container.replaceChildren();
                imgEl = document.createElement('img');
                imgEl.alt = 'Bot 视角画面';
                container.appendChild(imgEl);
                const tag = document.createElement('span');
                tag.className = 'pov-tag';
                tag.innerHTML = '<span class="dot ok live"></span> 实时';
                container.appendChild(tag);
            }
            imgEl.src = probe.src;
            if (infoEl) infoEl.textContent = `${probe.naturalWidth}×${probe.naturalHeight} · ${new Date().toLocaleTimeString('zh-CN')}`;
            schedule(1000);
        };
        probe.onerror = () => {
            if (!alive) return;
            fails++;
            if (fails === 1 || !imgEl) {
                showPlaceholder(fails > 3
                    ? '截图管线还没产出画面。可在「高级 → 视觉」里确认视觉已开启。'
                    : 'Bot 进入游戏后会自动出现画面');
                if (infoEl) infoEl.textContent = '暂无画面';
            }
            // 连续失败就逐级放慢，别把控制台刷满 404（Bot 没启动时会一直 404）
            schedule(fails > 10 ? 15000 : fails > 3 ? 5000 : 1500);
        };
        probe.src = bust('/api/screenshot/latest.jpg');
    };

    const schedule = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(tick, ms);
    };

    tick();
    return () => { alive = false; clearTimeout(timer); };
}

// ── 动作 ────────────────────────────────────────────────────────────────────
async function agentAction(kind, btn) {
    const done = busy(btn);
    const name = botName();
    try {
        await post(`/api/agent/${kind}`, {});
        toast(kind === 'start' ? '已发送启动指令' : kind === 'stop' ? '已发送停止指令' : '已发送重启指令', 'ok');
    } catch (err) {
        // 后端接口没就绪时退回 socket 协议（老通道一直在，能用就用）
        if (err instanceof ApiError && err.missing && name) {
            const ev = kind === 'start' ? 'start-agent' : kind === 'stop' ? 'stop-agent' : 'restart-agent';
            emit(ev, name);
            toast('已通过实时通道发送指令', 'ok');
        } else {
            toastError(err, '操作失败');
        }
    } finally {
        done();
    }
}

async function say(message) {
    if (!message.trim()) return;
    const text = message.trim();
    chatLog.value = chatLog.value.concat([{ who: '我', text, t: Date.now() }]);
    try {
        await post('/api/agent/chat', { message: text });
    } catch (err) {
        const name = botName();
        if (err instanceof ApiError && err.missing && name) {
            if (!sendChat(name, text)) toastError(new Error('实时通道也没连上'), '发送失败');
        } else {
            toastError(err, '发送失败');
        }
    }
}

// ── 装载 ────────────────────────────────────────────────────────────────────
export async function mount(root) {
    render(root, shell());

    const heroEl = qs('#hero', root);
    const vitalsEl = qs('#vitals', root);
    const doingEl = qs('#doing', root);
    const invEl = qs('#inventory', root);
    const invHint = qs('#invHint', root);
    const aroundEl = qs('#around', root);
    const chatEl = qs('#chatLog', root);
    const inputEl = qs('#chatInput', root);
    const povEl = qs('#pov', root);
    const povInfo = qs('#povInfo', root);

    // full_state 约 10Hz 推来，节流到 ~400ms 再渲染，省 CPU。
    let pending = false;
    const paint = () => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
            pending = false;
            try {
                renderHero(heroEl);
                renderVitals(vitalsEl);
                renderDoing(doingEl);
                renderInventory(invEl, invHint);
                renderAround(aroundEl);
            } catch (err) { console.error('[overview] 渲染出错', err); }
        }, 400);
    };

    renderHero(heroEl);
    renderVitals(vitalsEl);
    renderDoing(doingEl);
    renderInventory(invEl, invHint);
    renderAround(aroundEl);
    renderChat(chatEl);

    const offs = [
        botState.subscribe(paint, false),
        status.subscribe(() => renderHero(heroEl), false),
        agents.subscribe(() => renderHero(heroEl), false),
        connected.subscribe(() => renderHero(heroEl), false),
        chatLog.subscribe(() => renderChat(chatEl), false),
    ];

    const stopPov = startPov(povEl, povInfo);

    const offAct = onAct(root, (act, elm) => {
        if (act === 'start' || act === 'stop' || act === 'restart') agentAction(act, elm);
        else if (act === 'send') { say(inputEl.value); inputEl.value = ''; }
        else if (act === 'quick') say(elm.dataset.cmd || '');
    });

    const onKey = (e) => {
        if (e.key === 'Enter' && !e.isComposing) { say(inputEl.value); inputEl.value = ''; }
    };
    inputEl.addEventListener('keydown', onKey);

    return () => {
        offs.forEach(off => off());
        offAct();
        stopPov();
        inputEl.removeEventListener('keydown', onKey);
    };
}

export default { meta, mount };
