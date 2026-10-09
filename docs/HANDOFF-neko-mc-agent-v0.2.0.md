# mc-agent v0.2.0 变更交接（给 N.E.K.O. / Xiao8 侧）

> 2026-08-07。给要更新 `game_agent_minecraft` 插件文档与快速开始页的人。
> 结论先行：**面向最终用户的安装流程整个变了**，教程里"复制 keys.example.json → 填 OPENAI_API_KEY → 改 neko.json 模型名"这一整段现在是错的，要删。
> WebSocket 桥接协议、端口、帧格式**一个字没改**，插件代码不用动。

---

## 1. 一句话说清变化

| | v0.1.2（旧） | v0.2.0（新） |
|---|---|---|
| 启动器文件名 | `启动mc-agent.bat` | **`启动.bat`** |
| 填 API 密钥 | 手动把 `keys.example.json` 复制成 `keys.json` 再用记事本填 | **在控制面板网页里填**，`keys.example.json` 已删除 |
| 换模型 | 手改 `neko.json` 里的模型名 | 面板「AI 配置」页下拉选，自动写回 |
| bot 配置文件 | `neko.json`（且包内外各有一份，改错地方不生效） | **`bot.json`**，全包只有一份 |
| 解压后的目录结构 | `启动mc-agent.bat` + `node/` + `src/`（整个仓库） | `启动.bat` + `node/` + **`app/`**（代码）+ 用户文件平铺在包根 |
| 支持的供应商 | 实际只有 OpenAI 路径顺畅 | **国内 13 家直连**（DeepSeek/通义/智谱/Kimi/豆包/硅基流动等）+ 境外 5 家 + 本机 2 家 |
| bot 视角截图 | 打包默认**关闭**（env 默认 0，用户拿到的包不发截图） | **默认开启**，1000ms/帧、800×512 JPEG |
| 压缩包体积 | 211.5 MB | **174.6 MB** |

产物：`mc-agent-win-v0.2.0.zip`，174.6 MB，SHA256 `35FA313395CEA12B55B33497E6039AE0D9C7812591EADE6C8333CAC5D8D1FC95`，解压出一个 `mc-agent\` 文件夹。

---

## 2. 新的解压后目录

```
mc-agent\
├─ 启动.bat          ← 双击这个（旧名 启动mc-agent.bat 已不存在）
├─ 使用说明.txt      ← 面向玩家的完整说明，教程可以直接引用它
├─ bot.json          ← bot 的名字 / 人设 / 用哪个模型 / 皮肤（全包唯一一份）
├─ settings.json     ← 连哪个游戏、端口等，每项都有中文注释
├─ skins\            ← 皮肤图片
├─ node\             ← 便携 Node v22.13.0（用户不用装 Node）
└─ app\              ← 程序本体

首次启动后会自己多出：keys.json（存密钥）、bots\（记忆与日志）、runtime-flags.json
```

**没有 `keys.json`，也没有 `keys.example.json`。** 前者首次启动自动创建，后者已从项目里删除。

---

## 3. 新的最终用户流程（教程照这个写）

1. **解压** → 双击 `启动.bat`
   - 黑窗口会打出中文提示："还没有选择 AI 供应商，bot 暂不启动"
   - 浏览器自动打开控制面板 `http://localhost:8765`
   - ⚠️ 这一步**不会**也**不应该**去动任何文件

2. **在控制面板「AI 配置」页配密钥**
   - 供应商按 `国内直连 / 境外服务 / 本机运行` 分三组，国内组排最前面并标注"不需要梯子，注册即用"
   - 点一家 → 填密钥 → 点「测试连接」→ 测通后模型下拉会自动填上该供应商的真实模型列表 → 选一个
   - 每家卡片上有「去申请密钥」外链，直接跳该厂商的控制台
   - 密钥只落在本机 `keys.json`，API 响应里永远是掩码（`sk-a••••••••cd`）

3. **在「游戏连接」页填 Minecraft 局域网端口** → 点「启动 Bot」
   - 包里 `settings.json` 的端口是占位值 `25565`，**必须改成玩家自己那局的端口**
   - 提醒玩家：每次重新「对局域网开放」端口都会变

---

## 4. 你们那边要改的具体位置

### 4.1 `plugin/plugins/game_agent_minecraft/surfaces/quickstart.tsx`

| 行 | 现状 | 要改成 |
|---|---|---|
| 114（zh-CN COPY） | 「下面下个 mc-agent 解压、双击**「启动mc-agent.bat」**启动它」 | 文件名改成 **`启动.bat`** |
| 133 | 「解压到任意目录，双击里面的**「启动mc-agent.bat」**即可」 | 同上；另外**补一句路径限制**，见 §6 |
| **141 / 194 / 247 / 300 / 353**（zh-CN / en / ja / ko / ru 五个语言各一条） | 「首次启动前：在解压出来的根目录把 **keys.example.json 复制成 keys.json**，填上你的 OPENAI_API_KEY……如果用的不是 OpenAI，记得同步把 **neko.json 里的模型名**改成该提供商支持的模型」 | **整段删掉重写**。新文案大意：解压 → 双击 `启动.bat` → 浏览器会自动打开控制面板 → 在「AI 配置」页选供应商填密钥、点测试连接、选模型 → 在「游戏连接」页填局域网端口 → 点「启动 Bot」。**不要再提任何文件名和手动编辑**。 |
| 27 | `ADMIN_PANEL_URL = "http://localhost:8765"` | **不用改**，面板还在 8765 |
| 39–42 | 三个网盘链接 | **不用改**，但网盘里的 zip 要换成 v0.2.0 |
| 150 / 203 / 256 / 309 / 362 | 「mindserver 管理端口（默认 8765）……改 bot 配置都在这里」 | 措辞可以升级：现在这里是**唯一**的配置入口（密钥、模型、皮肤、bot 名字、游戏连接、行为开关全在这），不再是"可选的管理界面" |
| 151 / 204 / 257 / 310 / 363 | 「plugin 桥接端口（默认 48909）……改 NEKO_PLUGIN_WS_PORT」 | **不用改**，仍然如此 |

**另外请核实一处矛盾**：第 114 行说「还要给猫娘准备一个**正版 Minecraft（微软）账号**、在 mc-agent 里登录」。但 v0.2.0 的 `settings.js` 里 `auth` 默认是 **`"offline"`**（离线模式），随包的 `使用说明.txt` 也是按离线模式写的（"正版联机服务器默认进不去"）。这两处说法对不上，需要你们那边定夺是改文案还是改默认值。

### 4.2 `plugin/plugins/game_agent_minecraft/README.md`

- 第 32 行：`node minecraft-agent/index.js --port 48909` —— 这个路径和参数都不对了。实际是包根双击 `启动.bat`，或开发态 `node main.js`；端口不是 CLI 参数，是环境变量 `NEKO_PLUGIN_WS_PORT`（默认 48909）。
- 第 37 行「启动 Minecraft agent server，记下监听端口」—— 可以补一句"绿色包用户直接双击 `启动.bat` 即可，端口默认 48909 不用管"。

### 4.3 i18n

上面 §4.1 那段安装说明在 `quickstart.tsx` 里是**内联 COPY**（不走 `t()`），所以 zh-CN / en / ja / ko / ru **五份都要各自改**。已核实 `i18n/*.json` 八个语言文件里都只有 `plugin.name` 和 `plugin.description` 两个键，不含任何安装文案，**不用动**。

顺带一提：`plugin.description` 现在写的是「……并**实时观看游戏画面**进行解说」。这句话在 v0.1.2 上其实是**不成立**的——那版打包默认不发截图（见 §5 第 ① 条），猫娘从来没真正"看"到过画面。v0.2.0 才第一次让这句宣传语落地。

---

## 5. 集成契约：什么没变，什么变了

### 完全没变（插件代码不用动）
- WebSocket 地址 `ws://localhost:48909`，可用 `NEKO_PLUGIN_WS_PORT` 覆盖
- JSON 帧格式：`task` / `log` / `screenshot` / `task_finished` 全部原样
- `screenshot` 帧仍是 `{"type":"screenshot","image":"<base64>","encoding":"jpeg"}`
- 控制面板端口 8765（`mindserver_port`）
- 游戏内聊天指令前缀 `/neko`、白名单 `chat_whitelist` 语义不变

### 变了（会影响你们的运行时行为）

**① 截图现在默认会发过来了。**
旧包里 `NEKO_AGENT_SCREENSHOT_INTERVAL_MS` 代码默认是 `0`（关），只有我们自己的 watchdog 会把它打开——也就是说**网盘上那版 v0.1.2，普通用户装完是一帧截图都不发的**。v0.2.0 在随包的 `env.defaults.json` 里显式设成 `1000`，所以现在会按 ~1Hz 稳定推送。

好消息是你们本来就是按这个假设设计的：`service.py` 的 `screenshot_stream_min_interval_seconds = 6.0`，注释写着"防止按 agent ~1Hz 速率灌爆模型视觉上下文"。所以**不需要改代码**，只是那个节流阀从"从来没生效过"变成"真的开始工作了"。请留意视觉上下文的实际 token 消耗。

用户可以在面板「高级 → 视觉」里关掉或调频率（间隔滑块 clamp 在 200–10000ms），分辨率有 640×400 / 800×512 / 1024×640 / 1280×800 四档，默认 800×512。

**② 面板从"可选管理界面"变成"唯一配置入口"。**
旧面板改设置只写内存、进程一重启就回到默认值（`set-agent-settings` 从不落盘）。现在有了 `settings.json` 覆盖层 + REST API，改动真正持久化。你们文案里凡是"要改配置请编辑 xx.json"的地方都可以改成指向面板。

**③ 新增 REST API**（都在 `http://localhost:8765/api/*`，仅限 localhost，写操作要 `X-Panel-Token` 头，token 从 `GET /api/bootstrap` 取）。如果你们想在 N.E.K.O. 主程序里直接读 mc-agent 状态而不经 WebSocket，可以用：
```
GET  /api/bootstrap    {home, app, mindserverPort, firstRun, botName, keysReady}
GET  /api/status       {running, inGame, keysReady, agent, state}
GET  /api/providers    供应商目录 + 已配置状态（密钥永远掩码）
GET  /api/bot          {name, provider, model, thinking, conversing, skin}
GET  /api/skins        皮肤列表
GET  /api/settings     面向玩家的设置项（带中文 label/help）
GET  /api/flags        行为开关
GET  /api/logs?since=N 增量日志（已对 API key 做正则脱敏）
GET  /api/screenshot/latest.jpg  最新一帧（没有则 404）
```

---

## 6. 教程里需要新增的提醒

**① 解压路径不能太深。**
包里最长的相对路径是 168 字符（`@mistralai/mistralai` SDK 的文件名极长），Windows MAX_PATH 是 260，所以解压目标目录路径要短于约 90 字符。超了会在解压阶段报 `Could not find a part of the path`，而且报错**完全不提"路径太长"**，很容易被误判成压缩包损坏。

实测：`C:\mc-agent`(171) / `桌面\mc-agent`(199) / `下载\我的世界AI伙伴\mc-agent`(210) 都 OK；别放进 `下载\新建文件夹\新建文件夹(2)\...` 这种深处。

**② 皮肤功能需要服务端模组。**
面板「Bot 设定」页现在支持导入 PNG（拖拽或点选，只收 64×64 或 64×32）和点选切换、classic/slim 切换。但**皮肤要在游戏里真显示出来，Minecraft 服务端必须装 FabricTailor 模组**——路径是服务端解析的，不是 mc-agent 解析的。没装模组的话面板里能看到、游戏里还是默认皮肤，其它功能不受影响。面板里已经写了这句提示，教程里最好也提一句。

**③ 端口每次开局域网都会变。**
`settings.json` 里的 `port` 是占位值 25565，玩家必须按游戏聊天框打出的"本地游戏已在 xxxxx 端口开启"改。这是最高频的"bot 进不来"原因。

---

## 7. 附：新支持的供应商清单

面板里的分组与显示名。`未实测` = base_url 按公开资料填写，还没用真密钥验证过，面板上会标角标。

**国内直连（不需要梯子）**

| 显示名 | 内部 key | base_url | 备注 |
|---|---|---|---|
| DeepSeek 深度求索 | `deepseek` | `https://api.deepseek.com/v1` | 已实测。国内玩家首推 |
| 通义千问 / 阿里百炼 | `qwen` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 已实测。有 embedding |
| 智谱 GLM | `glm` | `https://open.bigmodel.cn/api/paas/v4` | 未实测 |
| 月之暗面 Kimi | `kimi` | `https://api.moonshot.cn/v1` | 未实测 |
| 豆包 / 火山方舟 | `doubao` | `https://ark.cn-beijing.volces.com/api/v3` | 未实测。模型名要填接入点 ID |
| 硅基流动 SiliconFlow | `siliconflow` | `https://api.siliconflow.cn/v1` | 未实测。有 embedding，可给别家兜底 |
| 阶跃星辰 StepFun | `stepfun` | `https://api.stepfun.com/v1` | 未实测 |
| MiniMax 稀宇 | `minimax` | `https://api.minimaxi.com/v1` | 未实测 |
| 腾讯混元 | `hunyuan` | `https://api.hunyuan.cloud.tencent.com/v1` | 未实测 |
| 百川智能 | `baichuan` | `https://api.baichuan-ai.com/v1` | 未实测 |
| 零一万物 Yi | `yi` | `https://api.lingyiwanwu.com/v1` | 未实测 |
| 魔搭 ModelScope | `moda` | `https://api-inference.modelscope.cn/v1` | 未实测 |
| 小米 MiMo | `mimo` | `https://api.xiaomimimo.com/v1` | 未实测 |

**境外**：OpenAI / Anthropic Claude / Google Gemini / OpenRouter 聚合 / xAI Grok
**本机**：Ollama / LM Studio（免密钥）

**思考模式默认全部关闭。** 面板每家有「关闭 / 低 / 自动」三档，默认「关闭」——游戏 bot 要的是低延迟动作，而且不少模型会把思考链直接倒进正文、混进 `!command` 解析里会把动作解析坏掉。没有可用旋钮的供应商（如 DeepSeek）开关会置灰并提示"该供应商靠选择非推理模型来关闭思考"。

---

## 8. 还没验证的（你们实测时留意）

- 截图帧端到端到达 N.E.K.O.（我这边没有活的 MC 世界，只验到了渲染器能初始化）
- 皮肤装了 FabricTailor 后游戏内是否真生效
- 标「未实测」的国内供应商用真密钥点「测试连接」能否通过
- 各家模型名：面板配好密钥后会调 `GET {base_url}/models` 拉真实清单，所以内置的模型名过期不影响使用，但如果哪家不支持 `/models` 就只能手输
