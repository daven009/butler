# 功能规格：智能搜房与看房行程规划
版本 1.0 | 新加坡独立房产中介自动化平台

---

## 目录
1. [背景与定位](#1-背景与定位)
2. [参与方与权限](#2-参与方与权限)
3. [功能流程总览](#3-功能流程总览)
4. [第零步：创建 Plan](#4-第零步创建-plan)
5. [第一步：搜索房源](#5-第一步搜索房源)
6. [第二步：买家确认感兴趣的房源](#6-第二步买家确认感兴趣的房源)
7. [第三步：中介规划分组](#7-第三步中介规划分组)
8. [第四步：Scheduling Agent Skill — 卖家时间收集](#8-第四步scheduling-agent-skill--卖家时间收集)
9. [第五步：例外处理](#9-第五步例外处理)
10. [第六步：最终行程](#10-第六步最终行程)
11. [容错层：非结构化回复处理](#11-容错层非结构化回复处理)
12. [用户控制权：撤销与回退](#12-用户控制权撤销与回退)
13. [少即是多：每屏核心动作设计](#13-少即是多每屏核心动作设计)
14. [排程规则](#14-排程规则)
15. [数据模型](#15-数据模型)
16. [相关 API 与技术](#16-相关-api-与技术)

---

## 1. 背景与定位

### 1.1 产品背景

本平台服务于新加坡独立房产中介，核心功能是通过 Meta WhatsApp Business Cloud API 自动处理买家询问、协调看房时间。本方中介需要将一个专用的业务 WhatsApp 号码绑定到平台，平台通过 Cloud API 代替中介在这个号码上收发消息，在后台处理重复性工作，需要人工介入时再通过 dashboard 通知中介。

### 1.2 本功能的定位

本功能是平台的 **Tour Planning 模块**，解决以下痛点：

中介帮买家找房时，需要同时联系多个对方中介协调看房时间，来回沟通耗时且容易出错。本功能通过以下方式解决这个问题：

- 提供增值搜房能力（名校圈、通勤时间、AI 语义筛选），超越 PropertyGuru 原生搜索
- 让买家通过一个无需登录的链接参与选房和填写可用时间
- 由 AI 自动联系所有对方中介，完成三方时间协调
- 生成按地理位置优化的看房行程表

### 1.3 App 导航结构

App 底部有五个固定入口：

```
Tours   Schedule   [+]   Client   Inbox
```

| Tab | 图标 | 职责 |
|-----|------|------|
| Tours | 路线图标（两个圆点 + 虚线连接） | 以客户为单位管理所有 Tour，查看每个 Tour 的当前状态 |
| Schedule | 日历 | 以时间为单位查看已确认的看房行程，月历视图，点击日期显示当天行程 |
| [+] | 居中红色圆形按钮 | 主操作按钮，点击直接进入 Search 新建搜索 |
| Client | 人像 | 客户管理（Client book），列表 + 搜索 + 新建客户 |
| Inbox | 信封 | 处理所有通知和决策卡（AI 无法自动处理的例外情况） |

**Tours 是底部栏的默认高亮项。** Tours 页面标题为 "Your tours"，顶部显示问候语（如"Good morning, David"），再往下是搜索入口（"Start a new tour"），然后是 Plan 列表。

进入 App 后看到的 Plan 列表示例：

```
[ Chen family   — 3BR Rental ]         🟡 Coordinating · 2 min ago
[ Rishi Patel   — Condo · Sale ]        ⚪ Searching · 1h ago
[ Hazel Koh     — HDB · Rental ]        🟢 Confirmed
[ Ng family     — Landed · Sale ]       🔵 Planning
```

Plan 状态枚举（原型当前实现，共 4 档）：

| 值 | 中文含义 |
|----|----------|
| `planning` | 规划中 |
| `searching` | 搜索中 |
| `coordinating` | 协调中 |
| `confirmed` | 已确认 |

当某个 Plan 有决策卡需要处理时，Inbox tab 会显示红点；决策信息集中在 Inbox 列表里展示，Plan 状态本身保留上面 4 档，不单独设"需处理"状态。搜索功能的入口在 Plan 内部或底部 `[+]` 按钮，不作为独立 tab。

> **原型当前的默认路由是 `/`（Onboarding 欢迎页），完成 3 步连接引导后才进入 `/home` Tours 页。** 该 Onboarding 只在首次使用时展示，之后正常启动直接进 Tours。

### 1.4 重要前提

- **本方中介**：使用平台 dashboard（Web 或手机 App）管理整个流程
- **对方中介**：只通过 WhatsApp 收到 AI 发出的消息，点击无需登录的链接选择时间段
- **买家 / 租客**：只通过无需登录的链接查看房源、标记兴趣、填写可用时间段
- 对方中介和买家都不需要注册或登录任何账号
- AI 发给对方中介的 WhatsApp 消息使用本方中介自己绑定的 WhatsApp Business 号码发出。对方中介收到的号码就是本方中介的号码，没有任何中间层。AI 在每段对话开头都会表明自己是 AI 助手身份，不会冒充中介本人

---

## 2. 参与方与权限

| 参与方 | 使用方式 | 权限 |
|--------|----------|------|
| 本方中介 | 平台 dashboard | 完整控制：搜索、确认短名单、分组规划、触发协调、处理例外、确认行程 |
| 买家 / 租客 | 无需登录的共享链接 | 填写搜索需求、标记感兴趣房源、选择可用时间段 |
| 对方中介 | WhatsApp 消息 + 无需登录的链接 | 通过文字回复或点击链接：回复 available / 不 available、确认时间段 |

---

## 3. 功能流程总览

```
第零步：创建 Plan
中介输入客户信息 + 档案 → 创建 Plan → 所有后续步骤归属此 Plan

第一步：搜索房源
中介（或买家）搜索 → 两层筛选 → 勾选推荐房源

第二步：买家确认
系统生成链接 → 中介发给买家 → 买家标记感兴趣房源 + 选择可用时间段

第三步：中介规划分组
中介把房源拖入时间段 block → AI 给建议分组 → 中介调整确认

第四步：Scheduling Agent Skill
先联系所有卖家收集可用时间 → AI 全局分析能否串联 → 主动说服微调 → 生成可行时间窗口 → 买家确认 → 精确排列

第五步：例外处理
无法串联 → 生成备选方案给中介选 → 对方不回复 / 改时间 → 决策卡推给中介

第六步：最终行程
生成行程表 → 中介确认 → 一键分享给买家
```

---

## 4. 第零步：创建 Plan

在开始任何搜索之前，中介需要先为这个客户创建一个 Plan。Plan 是整个 tour 流程的容器，所有后续步骤（搜索、短名单、时间段、协调记录、行程）都挂在这个 Plan 下面，统一收口。

> **原型实现：Client tab（"Client book"）即 Plan 管理入口。** 右上角 `New client` 按钮进入创建表单（`/client/new`），点击列表某一项进入 Client detail（`/client/:id`）。原型目前以一个统一的"Client / Plan"记录承载客户档案 + Plan 元数据，未来拆分为独立概念。

### 4.1 Plan 基本信息（表单字段）

创建或编辑 Plan 时填写以下字段，除客户姓名外都可留空，中介可以随时回来补充：

| 字段 | 类型 | 示例 / 说明 |
|------|------|------|
| Client name | 文本（必填） | 如 "Chen family" / "Olivia Tan" |
| Phone / WhatsApp | 文本 | 如 "+65 9123 4567"，用于后续发送确认链接和最终行程 |
| Client type | 下拉（Buy / Rent） | 用 Buy 或 Rent 指代买卖 / 租赁两类流程 |
| Status | 下拉 | Planning / Searching / Coordinating / Confirmed，默认 Planning |
| Budget | 两个数值输入（Min、Max） | 可只填一侧，也可都留空；展示时拼成 "S$3.2k – S$3.8k" |
| Move-in target | 原生日期选择器 | 可留空；列表里显示为 "Jun 1, 2026" 这类本地化短日期 |
| Needs / constraints | 5 行文本域 | 逗号分隔关键词，如 "Pet-friendly, Near MRT, Family pacing" |
| Notes | 5 行文本域 | 任何需要记录的自由文本（家庭情况、通勤需求、看房节奏等） |

表单之外，详情页还会展示：
- 头像（从客户姓名自动生成首字母，支持中文单字）
- Move-in / stops / status 三格 "stat" 预览
- 若该 Plan 有正在进行的 Tour，会额外展示一个 "Linked tour" 卡片，可一键打开当前 tour 或 share shortlist

### 4.2 租房 / 买房档案（规划中）

规格层面希望在 Plan 下挂一份结构化的租客 / 买家档案，在协调阶段自动附在发给对方中介的消息里：

**租房档案**

| 字段 | 示例 |
|------|------|
| 国籍 / 居留身份 | 新加坡公民 / PR / EP 持有者 |
| 成人人数 | 2 |
| 小孩 | 1 名，5 岁 |
| 职业 / 公司 | Senior Manager，科技公司 |
| 租约年限 | 2 年 |
| 希望入住日期 | 2025 年 6 月 |
| 宠物 | 无 / 有（金毛寻回犬） |

**买房档案**

| 字段 | 示例 |
|------|------|
| 买家类型 | HDB 升级者 / 投资者 / 首次购房者 |
| 付款方式 | 现金 / 银行贷款 / CPF |
| 预计完成时间 | 希望 6 个月内完成 |
| 特殊要求 | 需要确认 ABSD 豁免资格 |

> **原型当前状态**：上述结构化档案字段尚未实现。原型以一个自由文本 `Notes` 字段承载所有家庭背景、特殊要求等信息，后续迭代再拆分为结构化字段。协调阶段 AI 生成介绍消息时若档案尚未填写，会提示中介补充，或在没有档案的情况下跳过介绍租客背景这一步，直接进入时间协调。

### 4.3 Plan 创建后的状态

Plan 创建完成后，Status 默认 `planning`，中介可立即进入搜索步骤。规格层面希望 Plan 的状态按以下主干推进：

```
SEARCHING → SHORTLISTED → PENDING_BUYER → PLANNING → COORDINATING → CONFIRMED → COMPLETED
```

> **原型当前简化为 4 档：`planning / searching / coordinating / confirmed`**（见 §1.3）。更细的阶段（SHORTLISTED、PENDING_BUYER、COMPLETED 等）尚未在 UI 上区分，后续迭代补齐。

所有搜索记录、短名单、时间段选择、协调记录、最终行程都归属于这个 Plan，中介可以随时回到 Client detail 查看进度或补充客户档案。

---

## 5. 第一步：搜索房源

### 5.1 搜索方式：与 AI 对话

搜索只有一种方式——直接和 AI 说话，用文字或语音均可。中介不需要学习任何搜索语法或填写表单，描述客户需求就够了。

> **原型现状**：Search 页（`/search`，由底部 `[+]` 按钮或 Tours 顶部 "Start a new tour" 进入）已实现三种输入 source：语音 🎙（Voice）、手打 ⌨（Typed）、粘贴链接 🔗（From link），并会把 source 在 tag 上标注出来。原型内置一组 demo 输入（Bishan HDB 3BR、"within 30 min drive to one-north"、PropertyGuru URL 样例），演示对话式补充和 URL 识别的效果。

```
中介（文字或语音）：
"My client is looking for a 3-bedroom HDB near Bishan MRT,
budget around $3,000, must be within Nanyang Primary 1km circle,
and the landlord should be okay with a small dog."
```

语音输入自动转录后送入 AI 分析，与文字输入处理方式完全一致。

### 5.2 AI 分析需求，生成 Tag

AI 解析对话内容，自动提取关键条件并生成 Tag，显示在搜索框下方：

```
[ HDB ] [ 3 Rooms ] [ Near Bishan MRT ] [ $3,000/mo ] 
[ Nanyang Primary 1km ] [ Pet Friendly ]
```

每个 Tag 代表一个筛选条件。中介可以：
- **删除** 某个 Tag（去掉这个条件）
- **继续对话** 补充新需求，AI 自动新增对应 Tag
- **直接搜索** 用当前所有 Tag 开始搜索

对话可以多轮，AI 会累积所有提到的条件：

```
中介：Actually, also needs to be within 30 min drive to one-north
AI 新增 Tag：[ 30 min Drive to one-north ]
```

**特殊情况：输入 URL**

如果中介输入的文字是一个 URL（如 PropertyGuru 的某个搜索结果页或单个 listing 链接），系统自动识别并抓取该 URL 的内容：

- **搜索结果页 URL**：提取页面中的筛选条件，转化为 Tag，并把符合条件的 listing 加入当前结果
- **单个 listing URL**：直接把该 listing 加入当前结果列表

URL 抓取的结果会和对话产生的 Tag 合并，中介可以继续对话进一步调整条件。

```
中介粘贴：https://www.propertyguru.com.sg/property-for-rent?...
系统识别为 URL → 抓取筛选条件
新增 Tag：[ Condo ] [ 3 Bedrooms ] [ Tampines ] [ $3,500 以下 ]
同时把该页面的 listing 加入当前结果
```

### 5.3 增值筛选层（两层）

Tag 生成后，后端分两层处理：

> **原型现状**：两层筛选管道尚未接入真实的 PropertyGuru / Google Maps / MOE 数据源。原型使用前端内置的静态 `LISTINGS` 数组（8 条样例房源，覆盖 Tampines / Bedok / Queenstown / Bishan），根据 Tag 做客户端过滤以模拟结果，用于演示交互和视觉。

**第一层：结构化查询（快）**

先跑第一层缩小房源池，再进行 AI 语义分析。

| Tag 类型 | 数据来源 |
|----------|----------|
| 房型、地区、价格等 | PropertyGuru API query 参数 |
| 名校圈（MOE 1km / 2km 报名圈） | MOE 官方学校坐标，直线距离计算 |
| 通勤时间（驾车 / 公共交通） | Google Maps Distance Matrix API，默认出发时间 8:30am |
| 步行到 MRT | Google Maps API |

**第二层：AI 语义分析（慢）**

仅对通过第一层的房源运行。AI 读取每个房源的 property description，判断是否符合无法结构化查询的 Tag，例如：

```
[ Pet Friendly ] [ South-facing ] [ Extra Storage ] [ Modern Renovation ]
```

每个语义 Tag 的判断结果附上置信度和原文依据：

```
Tampines Trilliant #05-11
✅ Pet Friendly   → "landlord welcomes pets"（来自描述）
✅ Extra Storage  → "extra store room included"（来自描述）
⚠️ South-facing  → 描述中未提及，建议直接询问对方中介
```

`⚠️` 标识提醒中介哪些条件需要自己核实，因为对方中介填写的描述可能不完整或过于乐观。

### 5.4 协作搜索：中介与买家共同参与

搜索页面可以由中介单独使用，也可以通过链接分享给买家共同参与。买家打开链接无需登录，双方实时看到同一份结果（Supabase real-time 同步）。买家同样可以用文字与 AI 对话补充需求，AI 会新增对应 Tag。

**权限说明**

| 操作 | 中介 | 买家 |
|------|------|------|
| 文字 / 语音对话补充需求 | ✅ | ✅ |
| 删除 / 调整 Tag | ✅ | ✅ |
| 查看所有筛选结果 | ✅ | ✅ |
| 标记感兴趣的房源 | ✅ | ✅ |
| 确认最终短名单 | ✅ | ❌ |
| 触发协调流程 | ✅ | ❌ |

### 5.5 房源卡片显示内容

每张卡片显示：

- 地址、单位号、价格、房型（来自 PropertyGuru）
- 与所选学校的距离，是否在 MOE 报名圈内
- 到指定工作地点 / MRT 的预估通勤时间
- AI 语义分析结果与置信度
- 对方中介姓名和 WhatsApp 号码
- 勾选框（加入短名单）

---

## 6. 第二步：买家确认感兴趣的房源

中介确认短名单后，系统生成一个链接，中介通过 WhatsApp 发给买家。买家打开链接无需登录。

**这一步只做一件事：让买家标记哪些房源想去看。**

不在这一步询问买家的可用时间——因为卖家时间尚未收集，问了也是白问。买家的时间会在 Skill 找到可行时间窗口后才单独询问（见第四步 8.6 节）。

**买家看到的页面**

买家逐一查看短名单里的房源卡片，标记哪些想去看。每张卡片显示地址、价格、房型和关键信息。标记完后点击"提交"。

**买家可以重新修改吗？**

链接在中介触发"开始协调"之前始终有效，买家可以重新打开链接修改选择。一旦中介点击"开始协调"，链接关闭，不再接受修改。如需修改，中介可在 dashboard 暂停协调、重新发链接。

> **原型现状**：原型已实现 **中介侧的分享入口**（`BuyerView.jsx`，路由 `/buyer`）：中介可以选择已有 Client 或临时填一个 "new client"（姓名 / 电话 / 备注），然后通过 WhatsApp 分享 shortlist 链接。**真正"买家打开链接后无登录地勾选感兴趣房源"的公开 H5 页面尚未实现**，后续需要单独做一个对外的无登录 buyer 端页面，并补齐"链接在触发协调前保持有效 / 触发后失效"的服务端开关。

---

## 7. 第三步：中介规划分组

买家标记感兴趣的房源并提交后，中介进入 Planning 界面。

### 7.1 界面结构

这一步的分组维度是**地理位置**，不是时间段——因为时间段还没有确定，由 Skill 在收集卖家时间后才知道。中介在这里决定的是"哪些房源应该在同一天一起看"。

**AI 已预先填好建议分组**，中介进入界面时看到的不是空白，而是 AI 按地理聚类已经摆好的分组。中介可以：

- 直接接受建议分组，点击"开始协调"
- 把某个房源移入其他区 / 暂时移出本次行程
- 在"开始协调"之前随意调整，不会产生任何对外通信

> **原型现状（`TourDetail.jsx`，路由 `/tour`）**：
>
> - 进入后顶部显示客户头像 + 姓名 + 一句副标题（如 "3BR rental · move-in June · pet-friendly"），并显示当前 Plan 状态徽章（Not started / In progress / Completed）
> - 房源按 `area` 自动聚合成多个可折叠卡片（Tampines / Bedok / Queenstown…）；每张卡片展示该区域的 listing 数量、对方中介、"walk ≤ 3 min" 这类近似度标签
> - 列表项展示对方中介头像、楼盘名、`unit · MRT`、状态徽章（Not started / Scheduling… / Needs you / 时间）
> - 顶部有一个 "Scheduling preferences" 底抽屉入口，可设置：
>   - Preferred dates（This weekend / Next weekend / Custom dates）
>   - Preferred time（Morning / Afternoon / Evening，多选）
>   - Trip length（Half day / Full day / 2 days）
>   - Notes to AI（自由文本，给 AI 一条额外偏好说明）
>   - 开始协调后这些偏好会被锁定为只读
> - **当前原型暂未实现"拖拽房源跨区"或"移回未分配"的交互**；中介只能展开/折叠各区卡片，后续迭代再补拖拽和"移出本次行程"的能力。

### 7.2 触发协调

中介对分组满意后，点击底部 "**Start AI Schedule**" 按钮，Scheduling Agent Skill 正式启动。这是唯一的触发点，中介在此之前可以随意调整偏好而不产生任何对外通信。

点击后状态变为 `running`：
- "Scheduling preferences" 抽屉被锁为只读
- 每个区/每个 listing 进入 "Scheduling…" 状态，顶部出现进度条与 LiveTicker（模拟的实时进度文案）
- 完成后状态变为 `completed`，底部按钮切换为 "**Preview final itinerary**"，点击进入最终行程预览
- 若某个 listing 在协调中出现异常（`thread.status === 'exception'`，如 Sarah Lim / Bedok Residences 的演示数据），该项会显示 "Needs you" 并可点击进入决策卡；其他正常项点击进入与对方中介的 Chat 线程

---

## 8. 第四步：Scheduling Agent Skill — 卖家时间收集

### 8.1 设计理念

这个 skill 的定位是**数字化的 assistant**，代替中介原本雇用的人工助理来处理看房时间协调。它不是一个被动的自动化工具，而是一个有目标的 agent——目标是把同区房源尽量串在同一个时间段 block 内，让买家一次出行密集看完。

遇到困难时，skill 会主动想办法说服对方配合，而不是直接放弃或转给中介。

### 8.2 执行顺序：先卖家，后买家

```
第一阶段：收集所有卖家可用时间
  原因：卖家（屋主 + 对方中介）的时间限制更多，是整个排程的瓶颈
  做法：同时联系所有对方中介，广泛收集可用时间段

第二阶段：分析能否串联
  AI 分析所有收集到的时间段，找出哪些组合可以把同区房源串在同一个 block

第三阶段：联系买家确认（第一次询问买家时间）
  卖家时间收集完毕、AI 找到可行时间窗口后，才第一次询问买家时间
  买家从已筛选的可行窗口中选择，而不是凭空选时间
```

### 8.3 联系对方中介的对话流程

对话分步进行，不一次性发完所有信息。

**租房流程**

```
第一条：确认房源是否在租
AI：  "Hi, I'm an AI assistant helping [中介姓名] with scheduling.
      Is your unit at [地址] still available for rent?"

↓ 仍在租 → 第二条
↓ 已租出 → 标记不可用，通知本方中介，移出 Plan

第二条：介绍租客背景（租房才有此步）
AI：  "My client is interested. A bit about them:
      - [国籍 / 居留身份]
      - [家庭：成人人数，小孩年龄]
      - [职业 / 公司]
      - [租约年限 + 入住日期]
      - [宠物情况]
      Would the landlord be open to this profile?"

↓ 屋主接受 → 第三条
↓ 屋主拒绝 → 通知本方中介决定是否继续

第三条：收集卖家可用时间段（可多选）
AI：  "Great! To arrange a viewing, could you share which
      time slots work for you? Feel free to select multiple —
      the more options you give us, the easier it is to
      coordinate.
      1. [日期，时段]
      2. [日期，时段]
      3. [日期，时段]
      Reply with the numbers, or select here: [链接]"
```

**买房流程**

```
第一条：确认房源是否在售
AI：  "Hi, I'm an AI assistant helping [中介姓名] with scheduling.
      Is your unit at [地址] still available for sale?"

↓ 仍在售 → 第二条
↓ 已售出 → 标记不可用，通知本方中介，移出 Plan

第二条：询问关键细节
AI：  "My client is keen to view. Could you share a few details?
      - Current asking price?
      - Is the seller open to negotiation?
      - Any outstanding mortgage or legal matters?"

↓ 对方回复后 → 第三条（同租房第三条格式）
```

**时间段选择链接**

对方中介点开链接无需登录，看到极简页面：

```
[中介姓名] 的客户希望查看 [地址]
请选择方便的时间段（可多选）：

[ ] 周六 19 Apr  上午 9:00am–12:00pm
[ ] 周六 19 Apr  晚上 7:00pm–9:00pm
[ ] 周日 20 Apr  下午 12:00pm–3:00pm

[ 提交 ]
```

对方中介也可以直接 WhatsApp 回复数字（如 "1, 3"）或自然语言（如 "Saturday morning works"），AI 均能解析。

### 8.4 主动说服策略

当对方中介给出的时间无法和同区其他房源串在同一个 block 时，AI 不直接放弃，而是主动尝试说服对方微调。

**策略一：用地理聚集作为筹码**

告知对方，买家当天已在附近看房，配合的话买家状态最好：

```
"We'll be in the [区域] area on Saturday morning viewing
two other nearby units at 10:00 and 10:30. If your unit
could fit anytime between 11:00 and 12:00, it would be
ideal — the client will be right there comparing options
in the same area."
```

**策略二：主动缩小范围降低决策成本**

不把问题抛回给对方，而是 AI 先给出具体建议时间：

```
"Would 11:00am or 11:15am work? We're flexible within
the Saturday morning block."
```

**策略三：请对方提供更多备选**

```
"If Saturday morning doesn't work, could you share 2–3
other slots this weekend or early next week? We'll do
our best to fit around your schedule."
```

**说服边界**：微调只在同一个时间段 block 内进行。若对方只能跨 block，AI 不继续说服，直接记录该时间段并进入全局分析。

### 8.5 全局分析：能否串联

收集到所有（或大部分）对方中介的可用时间段后，AI 进行全局分析：

```
能串联：同区房源存在重叠的时间 block
  → 进入买家确认阶段，只把可行的时间窗口发给买家选择

不能完全串联：部分房源时间无法合并
  → AI 生成几个方案推给本方中介选择：

  方案 A：放弃冲突的 listing，其余完整串联
  方案 B：分两天，每天各自按地理优化
  方案 C：保留所有 listing，分散多天

中介选定方案后，进入买家确认阶段
```

### 8.6 第一次询问买家时间

卖家时间收集完、AI 全局分析完成、找到可行时间窗口后，系统生成链接发给买家。这是整个流程中**第一次**询问买家的时间——买家看到的不是所有时间段，而是 AI 已筛选出的、卖家可配合的可行窗口，买家只需从中选择。买家打开链接无需登录：

```
我们为你安排了以下可看房时间，请选择方便的：

[ ] 周六 19 Apr 上午（Tampines 3个单位 + Bedok 1个单位）
[ ] 周日 20 Apr 下午（Queenstown 2个单位）

[ 提交 ]
```

买家看到的是地理聚集后的行程概览，而不是逐个单位选时间，更直观。

### 8.7 精确时间排列

买家确认后，AI 在已选的时间 block 内自动排列精确时间：

```
排列优先级：
1. 同区房源连续排，步行 ≤ 5 分钟视为同区，无 buffer
2. 跨区加驾车时间，向上取整到最近 15 分钟
3. 所有时间点向上取整到 :00 / :15 / :30 / :45
4. 每个单位固定 30 分钟看房时间
```

排好后 AI 回去跟每个对方中介确认精确时间，微调仅限同一 block 内：

```
AI：  "Thank you for your flexibility. We'd like to schedule
      the viewing at 11:00am this Saturday — does that work?"
```

---

## 9. 第五步：例外处理

### 9.1 对方中介不回复

```
24 小时无回复 → 发一次跟进：
  "Hi, just following up on the viewing request for [地址].
   Are you still available to arrange a viewing?"

48 小时仍无回复 → 停止 AI 跟进，推决策卡给本方中介：

⚠️ [地址] — 对方中介 48 小时无回复
   [ 本人直接联系 ]   [ 取消这个单位 ]   [ 继续等待 ]
```

### 9.2 说服失败，时间无法串联

AI 说服了 2 轮后对方仍无法配合 block 内时间：

```
记录对方实际可用时间
进入全局分析（见 8.5）
生成备选方案推给中介决定
```

### 9.3 其他例外场景

| 场景 | 处理方式 |
|------|----------|
| 房源已租出 / 已售出 | 自动移出 Plan，立即通知本方中介 |
| 屋主拒绝租客背景 | 通知本方中介，由中介决定是否继续 |
| 对方中介临时改时间 | AI 在同一 block 内重新协调；若跨 block 则推决策卡 |
| 精确时间确认失败 | 推决策卡给本方中介：接受 / 再提议 / 取消 |
| 买家拒绝所有可行时间窗口 | 通知本方中介重新规划

---

## 10. 第六步：最终行程

所有房源处理完毕后，生成最终行程表，按天和时间顺序排列：

```
Day 1 · 周六 19 Apr

10:00   Tampines Trilliant
        单位：#05-11 · 对方中介：David Tan · +65 9111 1111

10:30   Tampines Court
        单位：#12-08 · 对方中介：Rachel Ng · +65 9222 2222

11:00   🚗 驾车前往 Bedok · 约 15 分钟

11:15   Bedok Residences
        单位：#09-22 · 对方中介：Sarah Lim · +65 9333 3333


Day 2 · 周日 20 Apr

19:00   Queenstown View
        单位：#03-08 · 对方中介：James Lee · +65 9444 4444
```

本方中介在 dashboard 上确认行程后，可一键通过 WhatsApp 把行程发给买家。

---

## 11. 容错层：非结构化回复处理

现实中对方中介的回复行为高度不可预测，系统必须能处理各种非理想情况，而不是假设对方会按照预期流程操作。

### 11.1 非结构化文字回复

AI 需要能解析各种口语化、不规范的回复：

| 对方回复 | AI 解析 |
|----------|---------|
| "can tmr 2pm" | 解析为明天下午 2:00pm 可以 |
| "saturday morning lah" | 解析为周六上午时段 |
| "anytime weekend" | 标记周六周日所有时段均可 |
| "let me check with owner first" | 标记为等待中，24 小时后跟进 |
| "wats the offer" | 判断为询问租金条件，转交本方中介处理 |
| "ok" | 结合上下文判断：若在时间确认环节解析为确认，否则请求澄清 |

原则：**能解析就解析，不确定就请求澄清，不要猜测。**

### 11.2 语音消息

对方中介可能直接发语音而不打字。

```
收到语音消息
  ↓
自动转录（Whisper API 或同类服务）
  ↓
AI 解析转录文字
  ↓
解析成功 → 正常继续流程
解析不确定 → AI 用文字复述理解，请对方确认：
  "Just to confirm — you're available Saturday morning, is that right?"
```

### 11.3 不回复

```
24 小时无回复
  ↓
发一次跟进消息：
  "Hi, just following up on the viewing request for [地址].
   Are you still available to arrange a viewing?"

48 小时仍无回复
  ↓
停止 AI 跟进，显示决策卡片给本方中介：

⚠️ [地址] — 对方中介 48 小时无回复
   [ 本人直接联系 ]   [ 取消这个单位 ]   [ 继续等待 ]
```

### 11.4 临时改时间

已确认的看房时间，对方中介临时要求更改。

```
对方中介："Sorry, need to change the time"
  ↓
AI 回复：
  "No problem. What time works better for you?
   Please note our client is available:
   - [剩余可用时间段列表]"
  ↓
新时间在可用时段内且不冲突 → AI 自动重新排程，通知本方中介
新时间冲突或超出可用时段 → 显示决策卡片给本方中介
```

### 11.5 AI 无法判断时的 Fallback

当 AI 遇到无法自信解析的回复（例如对方讨论合同条款、投诉、或其他超出协调范围的话题），不猜测，直接 fallback：

```
第一步：AI 总结当前对话状态发给本方中介
  "Here's what I understand so far:
   - Unit is available ✅
   - Tenant profile accepted ✅
   - Time not yet confirmed ⏳
   Latest reply from opposing agent: '...'"

第二步：请本方中介决定
  "I'm not sure how to proceed. Please review and take over if needed."

第三步：本方中介选择：
  [ 继续由 AI 处理 ]   [ 一键转人工接管 ]
```

### 11.6 一键转人工接管

任何阶段，本方中介都可以对任何一个对话一键接管。接管后：

- AI 立即停止对该对话发出任何消息
- 本方中介在 dashboard 上直接查看完整对话记录并回复
- 协调结果由本方中介手动录入（时间、确认状态）
- 其他对话的 AI 协调不受影响，继续正常运行

---

## 12. 用户控制权：撤销与回退

### 12.1 各阶段的撤销能力

| 阶段 | 中介可以做什么 |
|------|----------------|
| 创建 Plan 后，未开始搜索 | 可删除 Plan，无任何对外影响 |
| 搜索中，未发链接给买家 | 可随时修改 Tag、清空结果、重新搜索 |
| 买家房源确认链接已发出，未触发协调 | 可重新发链接给买家修改房源选择；可修改短名单 |
| 规划分组中，未点击"开始协调" | 可自由拖动房源、调整分组，无对外影响 |
| 协调进行中 | 可对单个房源一键暂停或取消；可一键转人工接管某个对话 |
| 协调进行中，需修改买家时间段 | 暂停协调 → 重新发买家链接 → 买家修改后重新触发 |
| 最终行程已生成，未分享给买家 | 可返回调整个别时间，或取消某个房源 |
| 行程已分享给买家 | 需人工通知买家，系统不自动撤回已发送的 WhatsApp 消息 |

### 12.2 从任意阶段返回

Plan 的状态始终可见，中介可以从 dashboard 随时返回查看任一 Plan 的当前状态和历史记录。已完成的步骤不会因为返回而自动重置，中介需要明确操作才会触发变更。

### 12.3 取消单个房源

协调过程中，中介可以随时取消某个房源：

```
取消前 AI 尚未联系该对方中介 → 直接移出，无需通知
取消前 AI 已联系该对方中介   → AI 发送一条礼貌的取消通知：
  "Hi, we'd like to withdraw our viewing request for [地址].
   Apologies for any inconvenience. Thank you for your time."
```

其余房源的协调流程不受影响，继续正常运行。

---

## 13. 少即是多：每屏核心动作设计

本章说明"少即是多"原则在各个关键界面的具体落地方式。每个界面聚焦一个核心动作，避免中介在同一屏幕面对多个决策。

### 13.1 各界面的核心动作

| 界面 | 核心动作 | 次要信息处理方式 |
|------|----------|-----------------|
| Tours 列表 | 查看 Plan 状态，点进某个 Plan | 状态标签简化为四种：搜索中 / 协调中 / 已确认 / 需处理 |
| 新建 Plan | 填写客户姓名、号码、类型 | 档案字段收起，进入后再填 |
| 搜索页 | 和 AI 对话描述需求 | Tag 在对话框下方展示，结果在 Tag 下方展示，不同时抢占注意力 |
| 买家确认链接（第一次）| 只标记感兴趣的房源 | 不询问时间，单一动作 |
| 买家时间确认链接（第二次）| 从可行时间窗口中选择 | AI 已筛选，买家只需选一个 |
| 规划分组 | 拖动房源到时间段 block | AI 建议已预填，中介只需调整不满意的部分 |
| 协调进行中 | 查看各 listing 的协调状态 | 只有"需要处理"的 listing 显示决策卡，其余折叠 |
| 决策卡 | 三选一：接受 / 再提议 / 取消 | 每张卡只处理一个 listing，不堆叠多个决策 |
| 最终行程 | 确认行程，一键分享 | 行程按天折叠，默认展开最近一天 |

### 13.2 搜索页的渐进展示

搜索页信息量最大，采用渐进展示避免认知过载：

```
第一屏：只有对话框 + 麦克风图标
  ↓ 中介输入后
第二屏：对话框 + Tag 列表（结果还在加载）
  ↓ 筛选完成后
第三屏：对话框 + Tag 列表 + 房源结果
```

结果加载时显示骨架屏，不显示空状态或 loading spinner，减少等待焦虑。

### 13.3 Inbox 的优先级排序

Inbox 里可能同时有多条通知，按以下优先级排序，最紧急的永远在最顶部：

```
🔴 需要中介决策的（决策卡）         ← 最高优先级，顶部显示
🟡 AI 正在处理中的进度更新          ← 中间
🟢 已自动完成的操作通知             ← 底部，可折叠
```

已读的通知自动收进"历史记录"，不堆积在主列表里。

### 13.4 决策卡的单一原则

当有多个 listing 同时需要中介决策时，不一次性展示所有决策卡，而是：

```
一次只显示一张决策卡
处理完后自动显示下一张
顶部显示进度："还有 2 个需要处理"
```

这样中介每次只面对一个决策，不会因为看到一堆卡片而产生处理压力。

### 13.5 行程分享的最后一步

最终行程确认页只做一件事：

```
显示行程预览（只读）
↓
[ 发送给买家 ]  ← 唯一的操作按钮
```

任何对行程的修改都需要先退出这个页面，回到上一步操作，防止中介在确认页误触修改。

---

## 14. 排程规则

| 规则 | 细节 |
|------|------|
| 每个单位看房时间 | 30 分钟 |
| 同区判断标准 | 步行 ≤ 5 分钟视为同区，无需额外 buffer |
| 跨区处理 | 步行 > 5 分钟，加入驾车时间（Google Maps，按实际出发时间查询） |
| 时间取整方式 | 所有时间点一律向上取整到最近的 :00 / :15 / :30 / :45 |
| 驾车时间取整 | 实际驾车时间向上取整到最近的 15 分钟倍数 |
| 同区聚集逻辑 | 同一地理簇的房源尽量安排在同一时间段 block |
| 锚定逻辑 | 同一地理簇内第一个确认的时间段，带动该簇其他房源优先填入同一 block |

**排程示例**

```
10:00   Tampines Trilliant #05-11     （看房 30 分钟）
10:30   Tampines Court #12-08         （看房 30 分钟，步行 3 分钟 → 同区，无 buffer）
11:00   驾车去 Bedok                  （实际 12 分钟 → 取整为 15 分钟）
11:15   Bedok Residences #09-22       （看房 30 分钟）
11:45   Bedok Grove #03-05            （看房 30 分钟，步行 4 分钟 → 同区，无 buffer）
12:15   结束
```

---

## 15. 数据模型

### Tour（行程）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| agent_id | UUID | 外键 → Agent |
| client_profile_id | UUID | 外键 → ClientProfile |
| tour_type | Enum | RENTAL / SALE |
| status | Enum | SEARCHING / PLANNING / COORDINATING / CONFIRMED / COMPLETED |
| search_query | Text | 对话式搜索的完整对话记录 |
| tags | JSON | AI 生成的搜索 Tag 列表 |
| created_at | Timestamp | |
| updated_at | Timestamp | |

### TourListing（行程中的每个房源）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tour_id | UUID | 外键 → Tour |
| listing_address | String | 房源地址 |
| unit_no | String | 单位号 |
| opposing_agent_name | String | 对方中介姓名 |
| opposing_agent_whatsapp | String | 对方中介 WhatsApp 号码 |
| status | Enum | PENDING / AVAILABLE / UNAVAILABLE / CONFIRMED / CANCELLED |
| available_slots | JSON | 对方中介确认的可用时间段 |
| confirmed_time | Timestamp | 最终确认的看房时间 |
| ai_analysis | JSON | 语义筛选结果与置信度 |
| coordination_step | Enum | AVAILABILITY / PROFILE / TIMESLOTS / CONFIRMED |

### TourDay（每天的时间段 block）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tour_id | UUID | 外键 → Tour |
| date | Date | 日期 |
| time_block | Enum | MORNING / AFTERNOON / EVENING / NIGHT |
| listings | JSON | 该 block 内的 TourListing ID 有序列表 |

### ClientProfile（客户档案）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| agent_id | UUID | 外键 → Agent |
| tour_type | Enum | RENTAL / SALE |
| profile_data | JSON | 所有租客或买家字段 |
| created_at | Timestamp | |

---

## 16. 相关 API 与技术

| API / 服务 | 用途 |
|------------|------|
| PropertyGuru 第三方 API | 根据 query 参数抓取房源列表 |
| Google Maps Distance Matrix API | 通勤时间计算、房源间驾车时间 |
| Google Maps Directions API | 房源间步行时间（判断是否同区） |
| MOE 学校数据 | 学校坐标，计算 1km / 2km 直线距离圈 |
| Claude / GPT API | 自然语言转 query 参数、description 语义分析、对话回复解析 |
| Supabase Real-time | 中介与买家协作搜索时的实时数据同步 |
| Meta WhatsApp Cloud API | AI 向对方中介发送和接收所有协调消息 |

### 搜索处理管道

```
输入（文字 / 语音对话，或粘贴 URL）
  ↓
AI 解析意图，生成搜索 Tag
  ↓
提取 PropertyGuru query 参数
  ↓
调用 PropertyGuru API 抓取房源
  ↓
第一层筛选：名校圈 + 通勤时间（结构化，快）
  ↓
第二层筛选：AI 语义分析剩余房源（慢，按需）
  ↓
返回结果，附置信度指标
  ↓
中介 + 买家查看，勾选短名单
```

---

*文档结束 — 版本 1.0 — 智能搜房与看房行程规划功能规格*