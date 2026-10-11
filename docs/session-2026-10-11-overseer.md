# 监工作业归档：2026-10-09 ～ 10-11（v0.2.0 + 四 worker 并行）

> 世界 "新的世界 (11)"，Fabric 1.21.1，Normal，keepInventory=false，LAN 55916。
> 分支 `wip/v0.2.0-dist`（未推送）。本轮从 8ce0155 起又合入 128 个提交，工单推进到 T-0290。
> 读法：§1 战果 → §2 反复出现的 bug 模式（最值钱）→ §3 协作流程 → §4 运维 → §5 遗留。
> 重启流程以 `docs/parallel-tickets.md` 的部署锁一节为准，HANDOFF.md §2 的"流程 v3"已过时。

## §1 战果与现状

- 进度：bot 两度攒到盾 + 铁胸甲 + 铁护腿 + 铁镐，挖到第一颗钻石（10-11 05:0x），都在随后的死亡中丢失（keepInventory 关）。
  暂停时状态：死后重开局，5 分钟拿到 2 木镐 + 2 石镐 + 7 原木，正在下挖找铁。
- 死亡：death_log 共 56 条（含 C333 误归档后合并回来的 44 条）。本轮死因：被围 / 苦力怕 / 窒息 / 溺尸 / 摔落 + 补刀 / 饥饿磨血 + 补刀。
- 工单：约 205 张 verifying 待实机验收，这是下一轮的首要工作量。
- 已在实机验收过的关键链路：
  - 盾牌第一：造盾 → 上副手 → 自动举盾挡箭。
  - 饥饿死锁根治：白天饥饿算紧急；只剩生鸡肉就吃；侦察走不动就改成允许挖路；GoalFollow 跟随贴近猎物；HEAL 养伤锁存。
  - 食物链三道防线（T-0252/0245/0255）。
  - 挨饿时禁止疾跑（T-0273）。
  - 动物目击记录：时间衰减，按群体加权（T-0273 续）。
  - 开局首木（T-0256/0257/0271/0272）。
  - 下挖空洞垫块（T-0139）。
  - 窒息救援（T-0268）。
  - 夜间下矿与封坑 hold 不再互顶（T-0282）。
  - pathfinder 不再误停别的技能的挖掘（T-0260）。

## §2 反复出现的 bug 模式（审代码 / 审工单时逐条对照）

1. **提了必拒：提案判据和技能判据不同源。** 本轮出现 10 次以上，例如：
   - FOOD_FLOOR 派出 quickMeal 后零动作；
   - GET_PORTAL_KIT 只认锭，但提案把粗铁也算进去；
   - 夜里熔完铁、造不起下一件甲，仍然派 craftArmor；
   - IDLE_FALLBACK 派 chopWood，而 chopWood 必然 BAIL；
   - 4 格内有怪还派下挖。

   修法一律是两边调用**同一个导出函数**，并加一条源码同源断言测试。
2. **同一判据各写一份，然后漂移。**
   - "在不在地表"写了 5 份，树冠和坡地坑分别误判了 3 次（T-0189/0251/0257/0271），最后收成 surface_judge 一份。
   - 其他例子：白天的分界线（nightShelter 用 12800/23000，world_model 用 12000）、FILL_RE、FIRST_PICK_PLANKS_EQ、燃料留底。
3. **保护门没有紧急豁免，堵死了唯一的出路。** 例子：
   - T-0131 低血拒挖重力块，窒息时把头上的砂砾也拒了（death #55，丢了 24 铁和钻石）；
   - 饥饿冻身冻住了觅食；
   - 邻水不准下挖，导致夜里无坑可躲（#54）。

   审任何"拒绝 / 门"时都要问一句：**窒息、溺水、岩浆、饿死这些致命状态下，它是否放行？**
4. **双驾驶：绕过 kernel 的本能和技能同时驱动身体。**
   - go_to_bed_sleep 直接调 goToPosition 去 272 格外的床，和 smeltSafe 互相拉扯，把 bot 推下 20 格空洞（#56）；
   - 孤儿 collectBlock 把身体拖走 40 格；
   - edge_unstick 的后退和 swim 反射对拉。

   要求：长途移动的本能有真实承诺时让位，低血不触发，途中受伤就停（T-0284/T-0290）。
5. **让位必须以接收方就绪为前提。**
   - 夜计划派 mineDown，sealed night hold 却整夜持身，两边互顶一夜零进度（T-0282）；
   - mobility 和 reflex_watchdog 两个挖掘者互相取消。

   修法：同一判据决定"谁拥有身体"。
6. **豁免集合漏了某个状态。** 例：edge_unstick 让位 SWIM/POCKET，却漏了 SWIM_STUCK。修法：用前缀正则，并枚举测试。
7. **静默成功 / 静默失败。** 例子：
   - quickMeal 零动作返回；
   - chopWood BAIL 却返回真值；
   - ticket CLI 对非法状态报 "updated"；
   - craftArmor 写的日志不进 progress。

   要求：零动作必须返回失败或 deferred，并写一行 progress。
8. **决策层的状态必须能从世界状态重新推导，或者落盘。** 冷却、锁存都放在内存里，每次重启都会丢。养伤锁存改成纯由 hp 推导。
9. **一阶没解，二阶白修。** 首木 / 首镐的停滞反复出现。判据：重生后 5 分钟内应有 ≥8 原木和镐。不达标就先修这个，不看别的单。
10. **饿着过夜等于天亮出门送死。** 本世界是 Normal，饥饿只把血扣到 1，但 1 血出门碰到任何东西都会死。
    我自己在 03:49 拍板"今晚饿着过夜"，结果直接导致 death #53。黄昏前必须吃到 18。

## §3 多 worker 协作经验

- **一张单只派给一个人。** 加急单同时发给两个 worker 会撞单（T-0268）。worker 开单前先查看板（`ticket.mjs list | grep`）；先建单拿号，再在代码里写标签。
- **部署合并。** 改了 src 的修复，合入后由**最后合入的人**持锁重启一次；另一方用 `deploy-lock live <sha>` 看到 already LIVE 就跳过。热技能和 world_model 互相依赖时必须一起上线，否则会出现热转。
- **重启时机**（监工规则，写在 docs/parallel-tickets.md）：
  - 白天 + 附近没有可行敌对（hostileActionable）；
  - 或者夜里 bot 处于 ENTOMBED/POCKET + coverReal + actionable=0。

  worker 自己的 hp≥8 红线只有用户能放宽。bot 长时间 hp1 时，由监工按监工规则部署。
- **跨会话权限。** worker 在自己会话里被权限拦下的操作（例如 kill ticket-server），监工不代做，交给用户决定。
- **报告纪律。** 推翻自己的结论要主动更正（worker-death 两次纠正 watchdog 死因，worker-tier 纠正"Hard 难度"和坠落归因）。
  监工的猜测也要明确标成猜测（我猜过 reclaimTableAt、燃料只认煤，都错了）。
- **检测器上线前必须先回放校准**：`node bots/_supervisor/tools/replay-detector.mjs <detector> --triage`。
  IDLE-DISPATCH 第一次回放就挖出 14 段白天空站。

## §4 运维与基础设施

- C333 误归档：断线重连那条路径漏挂了 login 钩子，_worldId 为 null，于是退回裸装推断。T-0228 已修：记过种子之后，拿不到当前种子就绝不归档。
- watchdog 是单点。10-11 两次被外部单独强杀，凶手未明。现在的应对：
  - botwatch 反向保活（心跳 + 进程双信号判死，限频，写 ALERTS 留现场）；
  - watchdog 退出时写 EXIT 行；
  - ensure-stack 改用 Win32_Process.Create 拉起 watchdog（Start-Process 会继承会话的 Job Object，还可能被 claude.exe 的 `taskkill /T` 按 ppid 连坐）；
  - deathwatch v4 只盯正牌路径。
- 测试设施：
  - npm test 跑在开跑那一刻的 git 快照上（修了"编辑一半的源码被读到"的偶发红）；
  - 单条测试 120s 超时，并加 force-exit；
  - ticket CLI 对非法参数、非法状态直接报错（server 端的改动要重启 ticket-server 才生效，待用户决定）。
- 取证工具：
  - frames/ 截帧（`frame-at.mjs HH:MM:SS`）；
  - act_trace.jsonl 逐秒的持身者、按键、寻路状态；
  - [dig-abort] 探针记录是谁停了挖掘；
  - fall_probe 记录 ≥5 格摔落时的驾驶者。

## §5 遗留与下一轮起点

1. **T-0290（本能长途移动守卫）已合入 wip（5fd90798），但还没上线**，needs-restart 已登记。下一轮先持锁重启：白天 + 无可行敌对，或者夜里封闭坑。
2. 约 205 张 verifying 单，按实机信号逐张验收并关闭。优先看本轮新上线、还没见到信号的：T-0283 dig.settle、T-0285 净位移判卡。T-0291（放炉时挖掉现成的工作台）为 open，现场分析已写在工单里。
3. T-0289：遥测测试偶发失败（worker-tests）。
4. ticket-server 重启（用户决定），之后执行 `ticket.mjs update T-0288 --status duplicate --of T-0284`。
5. watchdog 被强杀的凶手：看 `bots/_supervisor/wd_deathwatch.log` 的 GONE/THREAT 行。
6. 待用户决定的问题：是否开 keepInventory（本轮因此丢了两整套铁装 + 钻石）；是否解除 MC_FOOD_INSTINCTS=0。
7. 提交还没推送到远端。
