# 下一轮开工指引（2026-10-11 暂停时写）

> 给接手的任何 agent（换客户端也一样）。先读本页，再读 [session-2026-10-11-overseer.md](session-2026-10-11-overseer.md)（10 条反复 bug 模式），最后读 [HANDOFF.md](HANDOFF.md)。
> Claude Code 的持久记忆在 `C:\Users\wehos\.claude\projects\C--Users-wehos-Project-mc-agent\memory\`。这个仓库的所有 worktree 共用这一份记忆，索引是其中的 `MEMORY.md`。别的客户端读不到它，所以要点都抄在本页。

## 1. 代码与分支状态

- `main` = `wip/v0.2.0-dist` = 本页所在提交，已推送 `origin/main`（github.com/wehos/mc-agent-neko）。其中包含 v0.2.0-dist 的全部工作，以及 PR #14（网页观察器，默认关闭，只支持 MC 1.20.6）。
- 主 checkout：`C:\Users\wehos\Project\mc-agent`（develop 分支）。日常作业的 worktree 是 `C:\Users\wehos\Project\mc-agent-upstream-sync`（wip/v0.2.0-dist）。
- worker 的 worktree 都已合并、没有残留改动：`mc-agent-wd`、`mc-agent-wt-stuck`、`mc-agent-wt-tests`、`mc-agent-wt-tier`。可以删，也可以复用。
- **版本：v0.2.1 已发布，下一次发版是 v0.2.2。** git tag 只到 v0.1.4、GitHub releases 为空，v0.2.x 走的是绿色包渠道，不要从 tag 推断版本号。

## 2. 运行中的栈

- 栈独立于任何会话运行：watchdog 由 WMI 拉起，父进程是 WmiPrvSE，会话关掉不影响它。
- 端口：
  - MC LAN 55916（用户开的世界"新的世界 (11)"，Fabric 1.21.1，Normal，keepInventory=false）
  - agent WS 48909
  - 控制面板 http://localhost:18765
  - 工单看板 http://localhost:48920（`node bots/_supervisor/ticket.mjs onboard`）
- 部署流程见 [parallel-tickets.md](parallel-tickets.md) 的"部署锁"一节：
  1. 合入；
  2. 执行 `deploy-lock.mjs needs-restart <sha>`；
  3. 执行 `acquire`（会自动跑全量测试）；
  4. 只杀匹配 `(main|init_agent)\.js` 的 node 进程，watchdog 会把它拉起；
  5. 执行 `live <sha>`；
  6. 执行 `release`。

  重启时机：白天且附近无可行敌对；或者夜里处于 ENTOMBED/POCKET、coverReal、actionable=0 的封闭状态。
- 开工第一件事：**T-0290（本能长途移动守卫，已合入未上线）需要重启上线。**

## 3. 用户给下一轮定的方向（2026-10-11）

1. **解除 `MC_FOOD_INSTINCTS=0`**（07-08 那条临时令作废）。
2. **进食只保留 best-effort 轻量本能**：低血或低体力时，兜里有吃的就顺手吃。
3. **farm 不许写进本能**。要不要种田、要不要备粮，交给主 agent（主脑）去想；要让主脑知道有这件事，但优先级不高。
4. **重点提升战斗能力和 farm 能力**（farm 是主脑可以调用的技能，不是本能）。战斗本能要系统设计：本轮死因大量是被围、苦力怕、骷髅、溺尸。
5. **夜间"下地还是原地"的决策目前缺失**：晚上挖 4 填 1 封坑休息时，bot 只会原地求生，从来不考虑下地挖矿。T-0282 只解决了"已经承诺夜挖时，hold 要让位"，"该不该选择夜挖"要作为决策层的显式选择来设计。
6. **监控面板要多一些易读、user-friendly 的内部状态说明**：bot 在想什么、在做什么、为什么。可以复用的素材有 bot_status_nl、kernel 承诺和理由、HEAL/FOOD 锁存、夜计划、冷却中的任务、mobility 状态。

## 4. 待用户决定 / 遗留

- ticket-server 要不要重启（worker-tests 被它会话的权限拦下了，监工不代做）。重启后执行 `ticket.mjs update T-0288 --status duplicate --of T-0284`。
- 是否开 keepInventory。本轮因为没开，丢了两整套铁装和一颗钻石。
- 约 205 张单处于 verifying，等实机验收。T-0289（遥测测试偶发失败）、T-0291（放炉子时挖掉现成的工作台）、T-0293（`NEKO_TEST_NO_SNAPSHOT=1` 模式下静默失败）都还 open。
- watchdog 两次被外部强杀，原因还没查明。看 `bots/_supervisor/wd_deathwatch.log` 里的 GONE/THREAT 行。

## 5. 用户的工作偏好（摘要，完整内容在记忆里）

- 全程用中文。
- 自主行动，不要停下来问确认。用户只在乎效率。
- 绝不建议重开世界，绝不作弊：失败就是框架的错。
- 修 bug 必须带回归测试，先红后绿。
- 必须在游戏里实机验收，mock 单测不算验收。
- 进度不增长本身就是罪。
- 开 PR 后自动挂一个 comment 监听，持续收新评论。
