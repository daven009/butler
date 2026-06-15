# HANDOFF — Butler / Appointment Scheduler

> 你是接手这个项目的 agent。**先读这一份**，再按需展开到其他文档。
>
> 这份文档只承担两件事：(1) 让你 5 分钟知道项目是什么、当前进度在哪里；
> (2) 把所有"地雷"和"必须知道的上下文"写清楚，避免你做出错误假设。

最后更新：2026-06-14（Singapore time）

---

## 1. 项目一句话

新加坡 property agent 的 AI 看房调度助手 — 把 PropertyGuru 上的房源批量导入 → 用 mock co-agent 对话补齐可看时段 → 算路线 + 排期 → 用户可在 chat 里指挥 AI 微调排程。

更完整的 PRD 在 `BUTLER.md`（§8.6 是当前主战场）。

---

## 2. 仓库 / 分支

- **主分支**：`staging-supabase-integration`
- 远端：`origin/staging-supabase-integration`（GitHub `daven009/butler`）
- 当前本地状态：`ahead 6, behind 0`（本次合并刚完成，**改动尚未 commit**）
- 备份分支：`backup-before-merge`（合并前的本地快照）、`remote-snapshot`（远端 `839a623` 快照）、`backup-before-nuke-staging`（更早的安全点）

历史上还有 `staging`（旧的非 Supabase 版本，已废弃）和 `master`（初始 commit，不维护）。**只用 `staging-supabase-integration`**。

---

## 3. 仓库布局

```
appointment_scheduler/
├── backend/          Express + TypeScript API，跑在 :8787
│   ├── src/
│   │   ├── server.ts                 路由注册
│   │   ├── lib/
│   │   │   ├── scrapers/             PropertyGuru Playwright 爬虫
│   │   │   ├── scheduling/           调度算法（planSchedule + proposalsService）
│   │   │   ├── repositories/         Supabase 数据访问层 + RLS-aware client
│   │   │   ├── llm/                  OpenAI chat agent + tool defs
│   │   │   └── ...
│   │   └── scripts/                  一次性脚本
│   └── supabase/
│       ├── schema.sql                目标 schema 全量（参考用，prod 通过 migrations 演进）
│       └── migrations/               已上生产的 migration（按日期命名）
│
├── web/              Vite + React + TypeScript 前端，dev :5173
│   └── src/
│       ├── App.tsx                   主入口 3000+ 行 mega-component
│       ├── api.ts                    API client（fetch wrapper + 类型）
│       ├── domain.ts                 共享类型
│       ├── components/               业务组件
│       ├── i18n.ts                   极简中文文案表
│       └── ...
│
├── extension/        Chrome MV3 extension（v1.0.5），用户从 PG 详情页一键导入
│   └── *.zip                         打包好的版本
│
├── deploy/           部署脚本（生产服务器 47.236.98.146）
│   ├── deploy.sh                     本地构建 + scp + 远端 docker run（覆盖式）
│   ├── rollback.sh                   从 deploy/dist/ 的归档快速回滚
│   └── nginx-host.conf               生产 nginx 配置
│
├── Dockerfile        多阶段构建，单镜像同时跑 vite 静态资源 + express 后端
└── docker-compose.yml （本地用）
```

frontend/ 目录是 v0 prototype，已废弃，不要碰。

---

## 4. 关键技术决策（写一遍以免每次重新发现）

- **数据存储**：Supabase Postgres + RLS。**所有业务表都有 RLS**，policy 是 `auth.uid() = user_id`。后端用两种 client：
  - `supabaseAdmin`（service-role key）只用于不能或不应受 RLS 限制的路径（如公开 share token 查询）
  - `supabaseForUser(jwt)` 是 RLS-respecting client，通过 `AsyncLocalStorage` 把当前请求的 JWT 注入到所有 repo 调用 — 见 `backend/src/lib/userContext.ts` + `requireUser` middleware
- **认证**：Supabase Auth (Email/Password + Magic Link)。前端 `web/src/auth.ts` + `SignIn.tsx`。后端用 `verifyToken` 解 Bearer token。
- **LLM**：OpenAI `gpt-4o-mini`，模型名硬编码在 `openaiClient.ts`。`SESSION_LIMITS` 100K prompt tokens / 30 turns 上限。
- **调度算法**：贪心 + cluster + buffer 三层，见 `backend/src/lib/scheduling/planSchedule.ts`。**不依赖 LLM**，确定性输出。每次 listing brief ready 后会联合重算全部 ready、未确认房源；已确认时段是不可移动硬约束。因此是锁定条件下的整体启发式优化，不是数学全局最优。
- **mock conversation**：项目还没接 WhatsApp，所以 co-agent ↔ AI 的对话是 `conversationsMock.ts` 按 listing 顺序循环 7 种脚本（happy / partial / unreachable / rejected）灌进 DB。Idempotent — 已 seed 过的 listing 不会重灌（避免反复点 re-run 时对话每次都变，调试地狱）。

---

## 5. 当前进度（按 BUTLER.md §8.6 milestone）

| Milestone | 状态 | 说明 |
|---|---|---|
| **M1** 命名步骤进度条 + 可重试 run | ✅ 上线 | progress UI 在 `c453c47` UI 重写后被淡化为 listing bullet 文案，但后端 `step_state` 机制仍在 |
| **M2 phase-1** scheduling chat 后端 read tools | ✅ 上线 | 4 个 read tools |
| **M2 phase-2** 4 个 propose_* write tools + Apply/Discard | ✅ 上线 | local proposal 可 apply |
| **M2 phase-3** ready-listing replan | 🚧 部分完成 | 首个 brief 建初始方案，后续 brief 联合重算全部 ready 房源并保留 confirmed；数学最优、多冲突精确时间仍待做 |
| **M3** chat-with-Butler 前端 | ✅ 上线 | extension import 后自动聚焦新 listing 并进入真实 Butler chat；旧 side panel 路径保留 |
| **M4** 排期锁定 / Confirm-Unlock | 🗑️ **撤回（关键背景，见 §7）** |
| **M5** edge case + 文案打磨 | ⏳ 未开始 | |

---

## 6. 这次合并背景（极重要！— 不读会犯大错）

一周前到 6/12 我在本地分支独立做了 6 个 commit：
- M4 lock 整套（DB `lock_status / locked_slot / locked_at` 列 + scheduler Step 0 预占 + apply 时打锁 + 前端 unlock 按钮）
- Butler persona / AI rules 设置面板 + `user_preferences` 表
- 部署瘦身（去 Playwright/Chromium，镜像 640M→240M）
- mock conversation 固化（seed-on-import + idempotent）
- 前端左右分栏 dock + 左侧 schedule、右侧 chat 的双窗 UI
- 本地 pg-listings fixture 数据 +96 行

**与此同时**，同事 `daven009` 在远端基于同一个公共祖先 (`ba09884`) 另起炉灶做了 `c453c47 "UI updates"` + `839a623 "Refactor scheduling activity into listing bullets"` — 是一次接近全量重写的前端改造，方向是**简化** + **中文化**：
- App.tsx 从 ~2300 行重写到 ~3300 行（新增 Plan CRUD / Tour CRUD / 扩展导入 / i18n / 中文 SignIn）
- 去掉了 chat 嵌入到 listing 卡片底部的设计，chat 回到 side panel
- 调度活动从 `SchedulingProgress` 大组件降级为 listing 卡片里 4-5 行 bullet 文案
- **没有引入** lock / persona 概念 — 同事不知道我做了 M4

合并策略（用户拍板）：**前端 100% 用远端，后端做最小匹配**。
具体执行（已完成）：
- 前端：13 个文件用远端覆盖 + 新增 `i18n.ts` + `AGENTS.md`
- 后端**加**：`PATCH /api/plans/:id`、`DELETE /api/plans/:id`、`DELETE /api/tours/:id` 路由 + repo 函数（远端 UI 新需求）
- 后端**删**：所有 M4 lock 字段读写 / `user_preferences` 表 / persona 注入 / `/api/listings/:id/unlock` / `/api/me/preferences` / 两个相关 migrations
- 后端**保留**：mock conversation idempotent / `applyProposal.select('id')` 兜底验证 / 部署瘦身

**对你的影响**：
1. 别再去翻代码找 `lockStatus / lockedSlot / butlerPersona / user_preferences` — 全部清干净了，如果你看到任何残留请删掉，那是漏网之鱼
2. **如果新需求需要 listing 锁定语义，不要复活 M4，先和用户聊设计** — M4 之所以撤是因为前端 UI 已经不再展示 lock 概念了
3. 备份分支 `backup-before-merge` 上有 M4 完整实现，如果将来要复活可以参考

---

## 7. 数据库状态（重要事实）

### Migrations 已上生产（按时间）
```
2026-06-03-scheduling-steps.sql       现役
2026-06-04-scheduling-sessions.sql    现役
2026-06-05-listing-locks.sql          ❌ 已从代码库删除，但 prod DB 里的列还在
2026-06-06-user-preferences.sql       ❌ 已从代码库删除，但 prod DB 里的表还在
```

### "代码 vs DB 漂移" — 待办
- `listings` 表上 `lock_status / locked_slot / locked_at` 三列在 DB 里还有，代码已不读不写。**短期无害**（Supabase 不会因为列没人用而崩），但应该写一个 down migration 清理。
- `user_preferences` 表 + 3 个 RLS policy + trigger 在 DB 里也都还在。同样待清理。
- **不要轻易 drop**：可能 prod 已有用户行（lock_status='user_locked' 的 listing）—— drop column 前先 select 看看现状。

### 表清单（最新）
```
plans / tours / listings / conversations / routes / scheduling_runs /
attention_items / scheduling_sessions / scheduling_session_messages /
schedule_change_proposals / listing_scheduling_briefs / share_tokens /
pg_listings_archive
```

`backend/supabase/schema.sql` 是目标态全量参考（已去掉 lock 列描述），但 prod 实际状态是按 migrations 累积出来的。

---

## 8. 本地开发

```bash
# 后端（端口 8787）
cd backend && npm install && cp .env.example .env && # 填 SUPABASE_* / OPENAI_API_KEY / ONEMAP_*
npm run dev        # tsx watch — 改后端代码自动热重载

# 前端（端口 5173）
cd web && npm install && cp .env.example .env.local && # 填 VITE_SUPABASE_*
npm run dev        # vite，proxy /api → :8787
```

### 现役进程检查
- `lsof -i :8787 -sTCP:LISTEN` 看后端
- `lsof -i :5173 -sTCP:LISTEN` 看前端
- 一旦改了 .env 必须**完整重启 backend**（tsx watch 不重读 .env）

### Type check
```bash
cd backend && npx tsc --noEmit      # 应该 exit 0
cd web && npx tsc -b                # 应该 exit 0
```

---

## 9. 部署

生产服务器：`admin@47.236.98.146`，域名 `app.hey-alfred.vip`（Let's Encrypt + nginx fronting）。

```bash
# 完整部署（构建 → 归档 → scp → 远端 docker run）
bash deploy/deploy.sh

# 回滚到 deploy/dist/ 中的某个旧归档
bash deploy/rollback.sh
```

**重要的 build-time 注入**：Vite 把 `VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY` 编进 bundle，所以 `deploy.sh` 必须从根目录 `.env` source 后用 `--build-arg` 传给 Docker — 这个曾经踩过坑（生产白屏 30 分钟）。代码里有详细注释。

镜像大小：约 240MB（已去 Playwright/Chromium，因为爬虫现在主要靠浏览器扩展，后端只在用户 `POST /api/tours/:tourId/import` 时才偶尔 fallback 到 server-side Playwright）。

---

## 10. Chrome Extension

- 路径 `extension/`，MV3，当前版本 v1.0.5
- 用户在 PropertyGuru 详情页点扩展按钮 → content_script 抓 DOM → POST `/api/tours/:tourId/import-from-extension`
- 主要接入域：`app.hey-alfred.vip`（v1.0.5 切换的）
- **未上 Chrome Web Store**，目前所有用户手工 load unpacked 或装 zip

---

## 11. 接下来该做的（按优先级）

1. **commit 当前合并的改动**（用户没 commit）。22 个文件变更没 commit，建议用一个 conventional commit 信息：
   ```
   feat(merge): adopt remote UI rewrite + retire M4 lock/persona
   ```
2. **跑端到端冒烟**：登录 → 创建 plan/tour → extension 导入 listing → 自动 seed mock conversation → 自动进入 AI 助手 → 输入“这套尽量上午”或“把这套插入路线” → 检查 full proposal/cascade → Apply。
3. **数据库清理**：写一个 down migration drop `lock_status / locked_slot / locked_at` 三列 + `user_preferences` 表。
4. **补齐 M2 phase-3 剩余部分**：多冲突精确时间 reschedule + 跨日期 availability 重收集。
5. 长期：M5 polish、WhatsApp 实际接入、Chrome Web Store 发布。

---

## 12. 测试数据（截至 6/13）

用户 Shufang 在 Supabase 上有几个测试 tour，最常用的是：

- **plan**: `testplan` / client `ssf` / `plan_id=6f738d7a-8531-4ede-9834-89ddb3740ed0`
- **tour**: `ssf_western_tour` / `tour_id=2dc1ff6e-f4ff-4cd4-8212-8c5ede856f31` — 16 条 listing，状态分布刚被改成 6 imported / 6 contacting / 2 not-responding / 2 sold（用于手测 UI 不同分支）

**注意**：用户后来反映"全变成需要处理了"+"conversation 全是 not available"。原因还没定位（可能是某个流程把状态又重置了，或 conversationsMock 的 7 种 scenario 分布偏向负面）。这个是当前 in-flight 问题，见 `DEV_PLAN.md`。

---

## 13. 文档索引

| 文件 | 内容 |
|---|---|
| `HANDOFF.md` | 这份 |
| `BUTLER.md` | 产品 PRD（1400 行）。§8.6 是当前主战场 |
| `technical_solution.md` | 架构、数据流、关键决策（300 行） |
| `DEV_PLAN.md` | 在做的 milestone + backlog |
| `change_log.md` | 时间倒序的"已发生重要变更" |
| `DESIGN.md` | UI / UX 设计稿索引 |
| `DEPLOYMENT_GUIDE.md` | 服务器、域名、证书、nginx 细节 |
| `CLAUDE.md` / `AGENTS.md` | LLM/Agent 行为守则（保守、surgical、写完测） |
| `README.md` | 新人 onboarding（前端方向居多） |

---

## 14. 你（接手 agent）的工作流建议

- 改任何"显著"东西（schema / API / 部署 / 依赖 / 安全），结束时**必须**在 `change_log.md` 最上方加一条
- 复杂前端任务前先在 `web/` 里跑 `npx tsc -b` 看基线干净
- 任何 git 危险操作（push -f / reset --hard / 改远端分支）—— **先问用户**，且**不允许触碰 `master` / `main`**
- 数据库 migration 永远写成 idempotent（`if not exists` / `do $$ begin ... end $$`），方便 prod 重跑无副作用
- 测试时优先用本地 supabase 数据，不要直接在 prod 改 schema
- 部署前必须本地 `npx tsc --noEmit` + `npx tsc -b` 双绿
