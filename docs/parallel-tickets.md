# 并行问题处理：ticket 系统（单一 MC session，多 agent 协作）

一场游戏（一个 bot、一个世界）只能有**一个驾驶员**，但"观测→诊断→改码"这条尾巴可以并行。
本系统把问题变成**持久、可认领、跨 session 同步**的工单，让我（主 session）spawn 的 subagent、
以及你新开的 Claude session，能瓜分问题而互不踩车。

## 架构

```
[1 个 bot：唯一控制车道] ──► 黑匣子(events.log/progress.txt/vitals.json/frame)
                                  │
                   botwatch.mjs 自动探测(death/stuck/idle/seal-fail) ─┐
                                                                      ├─► ticket-server (单写者, :48920)
                                  你 / agent 手动建单 ────────────────┘        tickets/<id>.json
                                  │
          ┌───────────────────────┼───────────────────────┐
      [agent A]               [agent B]               [user 新 session]   ← 并行,各读"录好的证据"
      claim T-1 → 诊断 → 补丁    claim T-2 → ...           claim T-3 → ...
          └───────────────────────┼───────────────────────┘
                          部署闸门：串行热重载/重启 + 冒烟自检（一次一个补丁）
```

**控制=1 车道（bot）；诊断+改码=N 车道（读证据+写代码）；部署=1 车道（串行）。**

## 新 session 一条命令上手

```
node bots/_supervisor/ticket-server.mjs   # 若没起(GET :48920/health 失败)先起这个
node bots/_supervisor/ticket.mjs onboard
```

`onboard` 打印：server 地址、各状态计数、所有 active 工单、哪些未认领、怎么认领。**读完即可开工。**

## 认领（跨 session 防撞车）

所有认领走 server 单写者 → 两个 agent 不可能同时拿到同一张单（第二个收 409）。

```
node bots/_supervisor/ticket.mjs next                 # 看下一张该做的未认领单
node bots/_supervisor/ticket.mjs claim T-0007 --as claude-B   # 认领;失败=已被别人拿,换一张
node bots/_supervisor/ticket.mjs mine --as claude-B   # 看自己认领了哪些
```

**身份 `--as <tag>`：每个 session 挑一个唯一 tag**（`claude-A`/`claude-B`/`user`…），否则认领会混。
也可设环境变量 `TICKET_ACTOR`。

## 工单生命周期

`open → claimed → in_progress → fixed → verifying(=观察中) → closed`（或 `wontfix`）

```
node bots/_supervisor/ticket.mjs update T-0007 --status in_progress
node bots/_supervisor/ticket.mjs comment T-0007 "根因=X,在 file:line"
node bots/_supervisor/ticket.mjs update T-0007 --status fixed --note "C282 ..." --commit <sha>
# 部署+游戏内验证后:
node bots/_supervisor/ticket.mjs update T-0007 --status verifying   # 已部署,盯实机
node bots/_supervisor/ticket.mjs update T-0007 --status closed --note "实机验证通过:..."
```

## ★回归测试钉死（2026-10-09 立为原则）

**每修一个 bug，必须同时在 `test/` 里加一条能把它钉死的测试**，否则不许转 `fixed`。理由：这套系统里同一个
bug 反复回来是常态（T-0010/13/16 三连复发、FF-0713 合并把旧修复冲掉、上游同步时一行冲突就能悄悄撤销某个防护），
"实机观察没复发"只能证明当下没触发，挡不住下一次重构或合并把它改回去。

- **先红后绿**：测试要能在**修复前的代码上失败**、修复后通过。写完先 `git stash` 掉修复跑一次确认它真的红过，
  再恢复（stash 用 `git stash push -m <唯一tag>` + 按 SHA apply，别用裸 pop，见 worktree 规则）。不会红的测试等于没钉。
- **钉机理不钉表象**：断言要对准根因那条判据（例："裸装新角色 + 旧 death_log → 必须归档"、"food=0 低血不得产出 HOLD"），
  不是"某函数被调用过"。纯函数/判据优先抽出来测；涉及 bot 状态的用现有 `*.sim.test.mjs` 的假 bot 套路。
- **命名带单号**：`test/<主题>.test.mjs` 里 `test('T-0123: <一句话机理>', …)`，ticket `--note` 写上测试路径，
  方便以后 grep 单号就能找到"这个坑被谁钉住"。
- **跑法**：`npm test`（= `node test/run.mjs`：在临时目录里跑全部测试，cwd 与 MC_AGENT_HOME 都隔离，绝不碰运行中 bot 的状态；单跑某个文件用 `node test/run.mjs test/xxx.test.mjs`，别直接 `node --test`）。改码后、部署前必须全绿；合并上游/同步分支后也必须全绿。
- **边界**：mock/单测 ≠ 游戏内验收（`closed` 仍要实机验证）。测试的职责是**防复发**，不是证明修好了。
  确实无法离线复现的（纯物理时序类），在 ticket 里写明"无法单测的原因 + 用什么实机信号兜底"，不能默默跳过。

## ★Autonomous 工作契约（agent 不空转 / 观察中不阻塞接单）

**核心：每个 agent 同一时刻只"真正在改" ≤1 张单（`in_progress`）；首次修完转"观察中"就立刻去接下一张，永不空转。**

- **observing ＝ `verifying`**：首次修好 + 部署 + 冒烟自检通过 → 转 `verifying`（语义＝**观察中**：补丁已部署在跑，等是否复发）。**转入观察后不再主动死盯**——靠 botwatch / Monitor 的复发信号被动触发返工。挂个 Monitor 盯回归信号即可，人/agent 不用守着。
- **不空转铁律**：当你**没有任何 `in_progress` 单**时（`verifying`/观察中的**不计入**占用），**立即 `claim next` 接下一张未认领单**开工。一个 agent 可以同时挂着 N 张 `verifying`（观察中）＋ 至多 1 张 `in_progress`（在改）。
- **复发 → 原认领者返工**：一张 `verifying` 单若**复发**（botwatch 对其 `dedupKey` 再次命中，或人工发现），该单 **reopen**（转回 `open`/`in_progress`），由**原 `claimedBy` 返工**（不是丢给新人）——预测落空的条目要么修正要么回滚（同 CHANGELOG 科学家纪律）。
- **真正 `closed`**：只有"观察足够久没复发 ＋ 游戏内验证通过"才 `closed`。observing 不是终点，是**待复发裁决的中间态**。

agent 主循环（伪代码）：
```
loop:
  if 我有 in_progress 单 → 继续改 → 修好+部署+冒烟 → update verifying(观察中) + 挂 Monitor 盯复发
  elif 有未认领 open 单   → claim next --as <我的唯一tag> → update in_progress → 开干
  else                    → 盯自己 verifying 单的复发信号 / 帮审别人的补丁 / 打磨三层
```

### ★agent 自驱动：别停在 checkpoint（自 loop 反模式，实测踩过）

**反模式（2026-06-20 实测）**：agent 做完一个工作单元，输出一段 checkpoint 进度报告，然后**停下来等用户**——即使没有任何需要用户拍板的事、`in_progress` 单还没推进、`open` 队列还有活。"我继续推 T-XXXX" 成了空话：**对话式 agent 输出文本＝让出控制＝回合结束**，没有外部驱动就自续不下去。

**根因**：这正是 mc-agent 反复强调的 bot 第三原则——"**周期性承诺必须有机制载体（节拍器强制叫醒），不靠自觉**"——agent 把它用在了 bot 身上，却对自己的工作循环靠自觉续航。自觉必断。

**改进①（行为）**：autonomous 模式下，**一个回合内做完一单立即调下一个工具推进下一单**，连续工作，进度报告**穿插从简、绝不作为停止信号**。只在两种情况收尾让出控制：(a) 看板真没有可推进的活（无 in_progress + 无未认领 open），或 (b) 撞到**不可逆操作 / 必须用户拍板**的硬阻塞（如重开世界、删数据、策略级抉择）。checkpoint 报告 ≠ 回合结束。

**改进②（机制载体）**：跨回合续航必须有节拍器，三选一——
- **用户 `/loop`**（dynamic，无间隔自排）驱动 agent：最可靠，agent 每轮被叫回来扫看板。
- agent 自挂 **`ScheduleWakeup`**（loop 上下文内）或 **cron** 定期回来跑"看板扫描"：有 `in_progress` 没推进？有未认领 `open`？有 `verifying` 复发被 reopen？→ 接着干。
- 节拍器内容固定为：`ticket.mjs onboard` + `mine --as <tag>` → 按主循环伪代码推进。

> 一句话：**agent 治 bot 的"靠自觉必断"，先治自己**。

**机制载体（已实现，T-0018）**：复发裁决由 `ticket-server.mjs` 的 `createOrMerge` 落地——同 `dedupKey` 的复发命中一张 `verifying`(观察中)/`fixed`(待部署) 单时，**自动 reopen**：有 `claimedBy` → `in_progress`（原认领者返工）、无认领 → `open`，并清空 `resolution`、history 记 `RECURRED while verifying — reopened`。所以"观察中的单复发→原认领者返工"是 server 强制的，不靠自觉。
- **配套纪律**：**别把还在复发的条件 `closed`**——`closed`/`wontfix` 不在 merge 范围，关了它复发就只能另开新 dup 单（实测 T-0010/13/16 三连重复＝当时误把食物荒漠 pin 反复 close 所致）。复发的条件留 `verifying`，让 server 自动 reopen。`closed` 仅用于"观察够久确实没复发"。

## 改码隔离（并行不踩）

多个 agent 同时改码 → 各自用 **git worktree**（`Agent`/`Workflow` 工具的 `isolation: worktree`），
补丁通过部署闸门串行合并。诊断阶段是对"录好的证据"只读 → 无限并行。

## 部署闸门（必须串行）

只有一个 bot、一个世界，所以**部署/重启必须串行**，一次一个补丁：

1. `node --check` 改动的文件（语法）+ `npm test` 全绿（含本单新增的回归测试，见上「回归测试钉死」）
2. 判断层级：
   - `bots/_supervisor/skills/<子skill>.js`（chopWood/feedUp 等）→ **热加载**，下次调用即生效，无需重启
   - `src/agent/**`（① 层 modes/skills/framework）+ **顶层 sticky `missionNether.js`** → **必须重启 main.js**
3. 重启配方（白天/无怪时做；夜里热重载封顶 skill 有把 bot 拽出庇护的风险）：
   ```
   # 杀 main + 清端口 8765/48909 + 重启(env NEKO_AGENT_SCREENSHOT_INTERVAL_MS=0)
   # 见 watchdog.ps1 的 Restart-Agent；冒烟自检:端口 48909 listening + vitals.json ts 新鲜(<20s)
   ```
4. 冒烟自检过 → 工单转 `verifying`，挂 Monitor 盯实机；游戏内验证通过才 `closed`（验收纪律：mock 单测≠验收）。

### 待捎带部署队列（无行为变化、不值得单独重启的改动）

纯重构/可测性改动不单独重启，排在这里，由**下一次任何人重启 main.js / botwatch 时捎带上线**。捎带的人部署后把对应行划掉（或删掉），冒烟自检同上。

| 合入提交 | 文件 | 需重启什么 | 说明 |
|---|---|---|---|
| ~~d51f7cc (worker-tests)~~ ✅ 23:56 随 T-0080 重启上线 | src/agent/agent.js + 新 src/agent/world_scope.js | main.js | C333 新世界检测原样抽出（T-0065 测试用），无行为变化 |
| ~~e7ca2bf (worker-tests)~~ ✅ 23:56 随 T-0080 重启上线 | bots/_supervisor/skills/kernelDriver.js | 顶层 sticky（cancel re-arm 或重启 main.js） | reflexBusy/famineStall/no-op 判据提为模块级纯函数，无行为变化 |
| ~~3b142d9 (overseer)~~ ✅ 23:59 随 T-0108/T-0091 重启上线 | src/agent/world_scope.js | main.js | C333 裸装兜底去掉 near 条件（keepInv-off 世界复活点远离死点误判）；本世界 world_id 已记录不再走兜底，故不急 |
| ~~c66eb0d (worker-tests)~~ ✅ 23:59 随 T-0108/T-0091 重启上线 | src/agent/modes.js + 新 src/agent/framework/kit_gate.js | main.js | 下矿 kit 闸(T-0088)原样抽出，无行为变化 |
| ~~433787b (worker-tests)~~ ✅ 23:59 随 T-0108/T-0091 重启上线 | src/agent/modes.js + 新 src/agent/framework/migration_triggers.js | main.js | 木荒 latch(T-0102)/recommend 冷却门(T-0106)原样抽出，无行为变化 |
| ~~f117053 (worker-tests)~~ ✅ 00:26 随 T-0060 重启上线(live 判定) | src/agent/agent.js + src/agent/modes.js + 新 src/utils/json_io.js | main.js | ⚠**行为修复 T-0116**：sticky_skill.json 死后重挂 / advisory·migrate_state 读取剥 BOM（无 BOM 文件行为不变） |
| ~~3c51024 (worker-tests)~~ ✅ 00:26 随 T-0060 重启上线(live 判定) | src/agent/library/skills.js | main.js | breakBlockAt 成功路径清除 60s 超时定时器（定时器泄漏），无行为变化 |
| 06031ef (worker-tests) | src/agent/modes.js + src/agent/swim_progress.js | main.js | mobility 基础分类/SWIM tick(T-0098)/封顶水牢溺水让位(T-0104)原样抽出，无行为变化 |
| 5251b5f (worker-tests) | src/agent/modes.js + src/agent/framework/kit_gate.js | main.js | digOneCapViable(T-0107)原样抽出，无行为变化 |
| aab013c (worker-tests) | src/agent/modes.js + 新 src/agent/combat_gates.js | main.js | 战斗仲裁门(T-0063 族 C332/C353/C354/C360/C367)原样搬出，无行为变化 |
| 78c3203 (worker-tests) | src/agent/modes.js + 新 src/agent/mobility_geom.js | main.js | detectSealedRoom(T-0074 C341)原样搬出，无行为变化 |
| ~~b7fda85 (overseer)~~ ✅ 00:17 cancel re-arm 上线 | bots/_supervisor/skills/kernelDriver.js | 顶层 sticky（**白天无怪** cancel re-arm） | ⚠**有行为变化·优先**：派发器等待改 pace()（不认 interrupt_code），根治 interrupt 粘住时 1.3s 跑满 5000 次热转。注意 kernelDriver 测试须注入 ctx.pace |

**部署锁（2026-10-10 起为强制机制）**：同一时刻只允许一个 agent 重启 stack / re-arm sticky。
实录撞车：worker-death 已 comment "deploying now"，worker-stuck 的扫描漏看，又杀了刚拉起 12 秒的 main.js。口头约定靠每人各自扫评论，必漏。现在：

```
node bots/_supervisor/deploy-lock.mjs acquire --as <你的tag> --reason "T-xxxx main.js restart"   # 失败(exit 1)=别人在部署,等
# ... 合并 → npm test → 重启/re-arm → 冒烟自检(CreationDate + 48909 + vitals 新鲜) ...
node bots/_supervisor/deploy-lock.mjs release --as <你的tag>
node bots/_supervisor/deploy-lock.mjs status                                                     # 看谁持有
```

- 锁是 O_EXCL 原子创建的 `bots/_supervisor/deploy.lock`；超过 15 分钟视为持有者已死、可接管（会打印接管记录）。
- 工单里照旧 comment "deploying now"/"deployed" 留痕，但**是否能部署只看锁**，不看评论。
- 冒烟自检没过也要 release（失败也是结果），并在工单里写清楚。
- **捎带判定（先于拿锁）**：`node bots/_supervisor/deploy-lock.mjs live <sha>`（botwatch 的改动加 `--proc botwatch`）。exit 0 = 运行中的进程启动晚于该提交**落地主工作树**的时间（按分支 reflog，不是提交时间），代码已随别人的重启上线 → **不要再重启**，直接按该进程 CreationDate 验收；exit 1 才拿锁重启。（10-10 00:21 worker-death 的 C356-C358 就是这样捎带上线的，省掉第 4 次叠加重启。）只对需重启 main.js/botwatch 的改动有意义；顶层 sticky 的 re-arm 与热加载子 skill 不适用。

## 自动探测在测什么（botwatch.mjs）

| 信号 | type | dedupKey | 触发 |
|---|---|---|---|
| 死亡计数上升 | death | death-loop | death_log.jsonl 增长 |
| 位置停滞 >6min | stuck | stuck:<区块> | pos 不动 |
| 进度冻结 >6min | idle | frozen | progress.txt 末行不变 |
| 封顶反复站下 | seal-fail | seal-fail | events.log ≥4× "Can't seal" |

dedupKey 让进行中的同一问题**合并成一张单**（bump occurrences），不刷屏。手动单不去重。

## 关键端点（agent 直接 curl 也行）

```
GET  http://localhost:48920/api/tickets?status=open-ish
POST http://localhost:48920/api/tickets/T-0007/claim   {"actor":"claude-B"}
GET  http://localhost:48920/            # 人类网页 UI(建单/认领/改状态)
```
