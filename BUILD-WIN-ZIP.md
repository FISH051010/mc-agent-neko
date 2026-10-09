# 构建并分发 mc-agent Windows 绿色包

> 给打包 / 分发任务的接手人。整个流程已经脚本化，本文档只讲**怎么调用、怎么验收、怎么上传**，
> 以及几条不看就会重蹈覆辙的教训。

mc-agent 是 Node.js 写的独立程序，跟 N.E.K.O. 主程序通过 WebSocket 通信（`ws://localhost:48909`）。
两者解耦分发 —— N.E.K.O. 安装包不带 mc-agent，玩 Minecraft 的用户从网盘下载本 zip 自己运行。

最终产物：`mc-agent-win-vX.Y.Z.zip`，解压后用户**双击「启动.bat」即可**，
不需要装 Node / npm / Visual Studio Build Tools，也不需要手动编辑任何文件。

---

## 一、怎么打

**必须在 Windows x64 上构建**（canvas / gl / prismarine-viewer 的 native prebuilt 是 win-x64 专用的，
跨平台产出的包用户跑不起来，截图管线会直接崩）。

```powershell
# 在仓库根目录下
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-win-zip.ps1 -Version 0.1.3
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-OutDir` | `D:\Downloads\mc-agent` | 包根目录，**会被清空重建**。zip 落在它的上一级 |
| `-Version` | 当天日期 | 不带 `v`。正式发版一定要显式传 |
| `-NodeVersion` | `v22.13.0` | 便携 Node 版本。mineflayer 4.37 + minecraft-protocol 1.66 要求 >= 22 |
| `-SkipNode` | 关 | 不下载 Node（用缓存，没缓存就退回系统 node 并**强制跳过打 zip**）。只用于本地迭代 |
| `-NoZip` | 关 | 只产目录不打包 |

全程约 **5–10 分钟**（`npm ci` 拉 prebuilt 占大头）。便携 Node 的 zip 会缓存到
`%LOCALAPPDATA%\mc-agent-build\node-cache\`，第二次起不再重复下载。

脚本会在中途自己把关，任何一项不过就 `exit 1` 且**不产出半成品**：

1. HEAD 里必须有全部必需文件（缺了当场报，不用等 `npm ci` 白跑五分钟）
2. 导出后断言：`main.js` / `settings.js` / `env.defaults.json` / `profiles/defaults/_default.json`
   / `bots/execTemplate.js` 等必须在；`bots/_supervisor/skills/*.js` 必须 > 50 个；`patches/*.patch` 必须有
3. 边界断言：`docs/` `test/` `tasks/` `watchdog.ps1` `keys.json` 等一律不许出现在产物里
4. `require('canvas')` + `require('gl')` 必须过（截图管线地基）
5. `node app/main.js --doctor` 必须 exit 0（**唯一能挡住"打出一个残废包"的机制手段**）
6. 兜底扫描：产物里出现 `sk-…` / `AIza…` / 开发机绝对路径 / 任何叫 `keys.json` 的文件 → 拒绝出包

> ⚠️ 打的是 **HEAD**，不是工作区。`git archive` 只输出已提交的内容，所以
> **未提交的改动不会进包**。脚本会把工作区脏文件列出来提醒你。
> 例外只有两个，它们从工作区直接取：`package-lock.json`（被 gitignore 了，进不了 archive）
> 和 `tools/dist/` 下的模板（启动.bat / 使用说明.txt / 中文提示文案）。

---

## 二、产出布局

```
<包根>/
├── 启动.bat            ← 用户双击这个
├── 使用说明.txt         ← 面向普通玩家的三步上手 + 常见问题
├── bot.json            ← 角色配置（名字 / 人设 / 模型）
├── settings.json       ← 连哪个游戏、控制面板端口
├── skins/
│   └── neko-skin.png
├── node/               ← 便携 Node（已拍平，node\node.exe）
└── app/                ← 代码，用户不需要碰
    ├── main.js  settings.js  env.defaults.json
    ├── src/  profiles/  patches/  bots/
    ├── dist-msg/       ← 启动.bat 用 type 打出来的中文提示
    └── node_modules/
```

**用户层的文件只在包根有一份，`app/` 里绝不留副本。** 这是历史投诉
"内外各一份、改了一份不生效"的根治点：运行时 `src/utils/paths.js` 把 `APP_ROOT`（= `app/`）
和 `HOME_DIR`（= 包根）分开，`src/utils/bootstrap.js` 会 `chdir` 到包根，两层各读各的。
`启动.bat` 里的 `cd /d "%~dp0"` 是这套布局的地基。

**不生成 `keys.json`。** 密钥一律走控制面板 GUI，首次启动 `bootstrap.js` 会自建空壳。
打包机器上的 `keys.json` 是真密钥，任何"顺手复制一份模板"的写法都是泄密路径。

---

## 三、验收清单

在**一台干净机器**（或至少一个干净目录）上解压后逐条过。少一条都不要上传。

- [ ] 双击「启动.bat」，弹出黑窗，**不闪退**
- [ ] 几秒后浏览器自动打开 `http://localhost:8765` 控制面板
- [ ] 控制面板「AI 配置」页能看到供应商列表，填入密钥后测试连接返回成功
- [ ] Minecraft 里「对局域网开放」，把端口填进面板「游戏连接」页，点启动 Bot
- [ ] **十几秒内游戏里出现机器人**，`!goToPlayer` 之类的指令有反应
- [ ] N.E.K.O. 主程序能连上 `ws://localhost:48909`，并且**能收到 bot 视角的截图**
      （截图管线是核心功能，不是可选项 —— 这一条挂了等于包废了）
- [ ] 把整个文件夹改名成带空格和中文的名字（例如 `我的 机器人`），再双击一次，仍然正常
- [ ] 关掉黑窗 → 进程干净退出，没有残留的 node.exe
- [ ] 全文搜一遍产物：没有 `keys.json`、没有 `C:\Users\`、没有 `.git`

`--doctor` 已经在构建时跑过一遍，但换机器后可以再跑一次确认：

```powershell
.\node\node.exe .\app\main.js --doctor
```

---

## 四、上传

传到三个网盘的对应目录：

- 夸克网盘：<https://pan.quark.cn/s/b662424f7f34>
- Google Drive：<https://drive.google.com/drive/folders/1DSx_y1MsTEvc5ljsjURNJ0aP1ax3RoN-?usp=drive_link>
- 百度网盘（提取码 `kuro`）：<https://pan.baidu.com/s/1i_a6IUQDz-GpEaWGvIcnqw?pwd=kuro>

文件名用脚本产出的 `mc-agent-win-vX.Y.Z.zip`。
**旧版本不要立刻删** —— 至少留 1–2 个，新版有问题好回滚。
把脚本打印的 SHA256 一并贴到发布说明里，方便用户校验下载完整性。

---

## 五、教训：为什么从黑名单改成白名单

旧流程用 `robocopy` + `/XD` **黑名单**复制整个工作区。它有三个结构性缺陷，
而且**都是静默失效**，不报错、看不出来：

1. `/XD` 拼绝对路径只排顶层同名目录 —— `.worktrees/*/node_modules` 全部逃逸；
2. 排除列表里写的是 `tests`，而仓库里的目录实际叫 `test` —— 打错一个字母就等于没写；
3. 仓库根的 `.git` 在 worktree 里是个 **78 字节的文本指针文件**（不是目录），
   `/XD` 对它根本不生效，`gitdir: …` 会原样进包。

**决定性的一点**：v0.1.2 之所以看着干净，不是黑名单起了作用，而是打包者当时恰好站在一个
零未跟踪文件的干净 worktree 里执行。旧文档正文写的源路径指向的是脏的主工作区
（4898 个未跟踪文件 / 2.8 GB / 含真实 `keys.json`）—— **照旧文档字面执行一次就会泄密**。

所以改成白名单：`git archive HEAD` 只输出被 git 跟踪且已提交的文件，
未跟踪的东西（日志 / `keys.json` / `.worktrees` / `node_modules`）在**物理上**进不了包。
再用仓库根的 `.gitattributes` 的 `export-ignore` 把"跟踪了但不该分发"的开发资产切掉。

改 `.gitattributes` 时注意两条铁律（细节写在文件顶部）：

- `git archive` 默认只读**被归档那棵树里**的 `.gitattributes`，文件没提交时一条规则都不生效。
  构建脚本因此固定带 `--worktree-attributes`。
- 给目录标 `export-ignore` 会让 archive **整棵剪掉、不再下钻**，之后没法再把子文件捞回来。
  所以 `bots/_supervisor` 是逐类排除的，`skills/` 目录本身故意不碰。

改完可以不产包只验清单：

```powershell
git archive --worktree-attributes --format=zip -o "$env:TEMP\chk.zip" HEAD
Expand-Archive "$env:TEMP\chk.zip" "$env:TEMP\chk" -Force
Get-ChildItem "$env:TEMP\chk"
```

---

## 六、教训：启动.bat 为什么必须是纯 ASCII

**cmd.exe 的批处理解析器在多字节字符上会把文件偏移算错**，从行中间继续解析，
把后半句当成命令去执行，报 `'xxxx' 不是内部或外部命令`。

2026-08-07 在 Win11 上实测了 18 种组合：

| 文件编码 | `chcp` | 控制台代码页 | 结果 |
| --- | --- | --- | --- |
| UTF-8 带 BOM / UTF-8 无 BOM / GBK | `chcp 65001` / `chcp 936` / 不 chcp | 936 / 65001 | **18/18 全部解析错位** |

**加 BOM 不解决问题**（旧文档写的 `UTF8Encoding $true` 只是让文件"看起来对"）。
唯一可行的组合是：

- `启动.bat` **纯 ASCII**（连注释都不能有中文）+ `chcp 65001`
- 所有中文提示放在 `app/dist-msg/*.txt`（**UTF-8 无 BOM**），用 `type` 打出来 ——
  `type` 直接吐字节，不过批处理解析器，所以不会错位

还有一条独立的坑：**`.bat` 必须是 CRLF 换行**。LF 换行时 `goto :label` 会报
`The system cannot find the batch label specified`（实测四个分支里坏掉一个）。
`.gitattributes` 已经给 `tools/dist/**` 声明了 `text eol=crlf`。

构建脚本对这两条都有断言（非 ASCII 字节数 / 孤立 LF 数），
所以**如果有人好心把中文"补"回 .bat 里，构建会直接拒绝出包**。

模板在 `tools/dist/`：`启动.bat`、`使用说明.txt`、`msg/{startup,stopped,crashed,incomplete}.txt`。

---

## 七、教训：`npm ci` 不能加 `--omit=dev`

`package.json` 的 `postinstall` 是 `patch-package`，而 `patch-package` 是 **devDependency**。
加了 `--omit=dev` 之后它不在 `node_modules` 里，postinstall 照样触发，
报 `patch-package is not recognized` 然后 `npm ci` exit 1。

代价是多几十 MB devDep，可接受 —— 瘦身阶段会把最大的两坨（`typescript` / `npm`）删掉。
`patches/*.patch` 必须进包，它修的是 mineflayer / minecraft-data / prismarine-viewer 的已知 bug，
补丁没进包等于把修过的老 bug 全放回来。

> ⚠️ 还有第二个更隐蔽的原因：**`eslint` 现在声明在 `devDependencies`，但它是运行时硬依赖。**
> `src/agent/coder.js` 第 9 行是顶层静态 `import {ESLint} from "eslint"`，
> 缺了它 `newAction` 整条"写代码 / 跑代码"的路径在 import 阶段就崩。
> 现在完全靠"不加 `--omit=dev`"兜着。构建脚本对此加了 `require.resolve('eslint')` 断言，
> 不管它声明在哪儿，装不上就不出包。**更彻底的修法是把 `eslint` 挪回 `dependencies`。**

---

## 八、瘦身的边界

脚本会删这些（每项都打印省了多少）：

- `node_modules/minecraft-data/minecraft-data/data/bedrock/` 下的各版本目录（约 320 MB，Java 版 bot 用不到）
  —— ★ **必须保留 `bedrock/common/`**：`minecraft-data/index.js` 顶部 eager `require` 了
  `bedrock/common/{protocolVersions,versions,legacy}.json`，删了 import 阶段就崩
- `node_modules/typescript`、`node_modules/npm`（删的是 `app/node_modules/npm`，
  **不是**便携 Node 自带的 `node/node_modules/npm` —— 后者是 `npm.cmd` 的本体）
- `node_modules` 里的 `*.md` / `*.map` / `test|tests|__tests__|docs|doc` 目录

★ **绝对不许碰的包**：`prismarine-viewer` / `three` / `gl` / `canvas` / `node-canvas-webgl`。
它们是截图管线的必需依赖，截图经 ws 48909 推给 N.E.K.O. 主 agent，是核心功能。
脚本把这几个包整片跳过，任何"这个看着没用"的判断都是错的。

---

## 九、N.E.K.O. 侧的契合点

用户下载 zip → 解压到任意位置 → 双击「启动.bat」。
N.E.K.O. 主程序里 `game_agent_minecraft` 插件的快速开始页会探测 `ws://localhost:48909`，
自动显示连接状态并给出跳转控制面板（`:8765`）的入口。

**默认端口不要改** —— 主程序写死 `48909` 作为 plugin `ws_url`。
真要改就得同步改插件的 `plugin.toml`。这个值在 `env.defaults.json` 的
`NEKO_PLUGIN_WS_PORT` 里，随包发行。

---

## 十、后续维护

- 源码改了 → 先 **commit**，再重跑脚本产新 zip
- Node 版本升级 → 改 `-NodeVersion` 重跑（旧缓存不用清，按版本号分文件）
- 加新 native 依赖 → 确认 win-x64 有 prebuilt，`npm ci` 和 `--doctor` 都要过
- 面向玩家的文案改动 → 改 `tools/dist/使用说明.txt` / `tools/dist/msg/*.txt`，
  注意保持 UTF-8 无 BOM（msg）与 CRLF
- 新增了必须随包发行的文件 → 同时更新 `.gitattributes`（别让它被 export-ignore 掉）
  和 `tools/build-win-zip.ps1` 里的 `$requiredInHead` / `$mustExist` 断言列表
