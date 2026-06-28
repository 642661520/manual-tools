# 系统操作手册工具链 — 设计文档

## 概述

通用操作手册编写平台，支持多项目独立管理。

### 角色与工作流

```
开发人员                  运维人员                  PM
────────                  ────────                  ──
维护 features.ts     →   在编辑器中对照骨架     →   审核内容
                          编写内容 + 上传截图        标记"已审核"

运行 export-skeletons                         →   导入骨架到 manual-tools
                                                  创建/管理 project
                                                  管理分类（categories）
                                                  创建/编辑 catalog
                                                  拖拽编排功能顺序
                                                  发布版本 / 预览 → 导出 PDF

新增功能骨架          ←   指派运维编写          ←   新建自定义功能
```

---

## 一、数据模型

### 整体结构

```
┌── 项目层（SQLite）────────── 多项目隔离 ──────────────────┐
│  projects 表                                               │
│  { id, name, description, review_chain }                   │
│  PM 可创建多个项目，各项目独立管理功能和目录                   │
├── 分类层（SQLite）────────── 功能分类 ──────────────────┤
│  categories 表                                             │
│  { id, name, color, sort_order, project_id }               │
│  替代旧 module 字段，PM 可自由创建/编辑分类                   │
├── 骨架层（SQLite）────────── 功能定义 ──────────────────┤
│  features 表                                               │
│  { id, title, description, sections, is_custom,            │
│    category_id, project_id }                               │
│  来源：开发者导入 + PM 自定义创建                            │
├── 内容层（Y.js 文档）─────── 运维编写 ──────────────────┤
│  documents 表（存 Y.js update 流）                          │
│  每个 section 是一个 Y.js 文档                              │
│  含 status, assignees, review_note, review_step,           │
│  review_log 等审核追踪字段                                  │
├── 编排层（SQLite）────────── PM 编排 ──────────────────┤
│  catalogs 表 + catalog_versions 表                         │
│  { id, title, targets[], features[], cover_info,           │
│    project_id }                                            │
│  一个 catalog = 一个构建目标的操作手册                       │
│  catalog_versions 存储每次发布的完整快照                     │
├── 用户层（SQLite）────────── 认证与权限 ──────────────────┤
│  users 表 + project_members 表                             │
│  { id, username, display_name, role, token_version,        │
│    feishu_open_id, ... }                                   │
│  token_version 用于角色/密码变更后强制下线                   │
└──────────────────────────────────────────────────────────┘
```

### 数据结构

```ts
// 项目
interface Project {
  id: string // 'default' | uuid
  name: string // '水域监管系统'
  description: string
  review_chain: string[] // 审核角色序列，如 ['pm'] 或 ['pm', 'admin']
}

// 分类
interface Category {
  id: string // uuid
  name: string // '水域监管'
  color: string // '#6366f1'
  sort_order: number
  project_id: string
}

// 功能骨架
interface FeatureSkeleton {
  id: string // 'waterway:sync-replay'  格式 {prefix}:{name}
  title: string // '同步回放'
  description: string // 功能描述 + 核心业务逻辑
  sections: FeatureSection[] // 必填，至少一项
  is_custom: boolean // 代码导入 false，PM 创建 true
  category_id: string | null // 所属分类
  project_id: string // 所属项目
}

interface FeatureSection {
  key: string // 'target-track' → 存储为 {key}.md
  title: string // '目标轨迹回放'
  description?: string // 子项提示说明
}

// 目录编排
interface Catalog {
  id: string
  title: string // '水域版操作手册'
  targets: string[] // 对应 BUILD_MODES 的 target
  features: string[] // featureId 的有序列表
  cover_info: Record<string, string> // 封面信息（subtitle, logo 等）
  project_id: string // 所属项目
}

// 导出版本快照
interface CatalogVersion {
  id: string
  catalog_id: string
  version_major: number // 主版本号
  version_minor: number // 次版本号
  title: string
  features_snapshot: string // JSON：导出时的 features 快照
  change_notes: string // 版本变更说明
  markdown: string // 完整 Markdown 内容
  status_snapshot: string // JSON：导出时的状态快照
  visibility: 'public' | 'login_required' | 'project_members'
  created_at: string
}

// 用户
interface User {
  id: string
  username: string
  display_name: string
  role: 'pm' | 'ops' | 'guest'
  token_version: number // 角色/密码变更时递增，旧 JWT 失效
  feishu_open_id: string | null
  feishu_name: string | null
  feishu_avatar_url: string | null
}
```

### 功能结构

所有功能必须有子项（sections），每个 section 对应一个 Y.js 文档。

```
Feature: 同步回放
  sections:
    - target-track  →  documents: waterway:sync-replay/target-track
    - video         →  documents: waterway:sync-replay/video
    - radar         →  documents: waterway:sync-replay/radar
    - ais           →  documents: waterway:sync-replay/ais
```

- sections 的顺序可由 PM 在编辑器中拖拽调整，自定义功能的 sections 可自由增删
- 代码导入功能的 sections 在导入时按开发者定义覆盖，但 PM 可在导入之间调整顺序
- Feature 在 catalog 中作为整体拖入，**不可拆分 sections**

---

## 二、多项目支持

### 设计原则

系统支持 PM 创建多个项目，每个项目拥有独立的 features、catalogs、categories 和 documents。项目之间完全隔离。

### 项目上下文传递

- 后端：通过 query 参数 `?projectId=xxx` 过滤，不传则返回全量（向后兼容）
- 前端：`useProject()` composable 管理当前项目，localStorage 持久化选择
- 初次启动自动创建 `default` 项目，所有旧数据归入

### 项目选择器

位于 AppLayout 顶部右侧，仅当项目数 > 1 时显示下拉框。切换项目时，功能列表和目录编排自动刷新。

### 项目管理

PM 在设置页可新建、编辑、删除项目。删除项目级联删除其下 features、catalogs 和 documents。`default` 项目不可删除。

### 不影响的核心模块

- Y.js 协同编辑 — feature ID 全局唯一，docId 路径不变
- PDF 导出 / 站点发布 — `assembleManual()` 按全局 ID 读取
- 导入机制 — 按 project 过滤已有 features 进行差异化对比

---

## 三、分类系统

### 设计动机

旧设计中 features 使用 `module` 字符串字段做硬编码分组（如 `waterway`、`frontier`），缺乏灵活性。分类系统将其抽象为独立的 `categories` 表：

- PM 可自由创建/编辑/删除分类，按项目隔离
- 每个分类有名称、颜色标记和排序权重
- features 通过 `category_id` 外键关联分类（可空）
- 代码导入的 features 需要 PM 手动分配分类，或根据导入时的元数据自动匹配

---

## 四、功能骨架导入

### 导入流程

```
开发者：
  1. 在项目源码中维护 features.ts 骨架
  2. 运行导出脚本 → 产出 features.json

manual-tools PM：
  3. 功能列表页 → 导入 → 上传 features.json
  4. 系统做差异检测 → 展示 diff 确认界面
  5. 确认 → 字段级合并写入
```

### 差异检测

以 `feature.id` 为稳定 key，对比导入的 JSON 和现有数据：

| 情况                       | 处理                                            |
| -------------------------- | ----------------------------------------------- |
| 新增（导入有，现有无）     | 标记"新增" → 确认后插入                         |
| 修改（两边都有，字段不同） | 标记"已修改" → 展示变更字段                     |
| 缺失（导入无，现有有）     | 标记"缺失" → 已有内容则保留为废弃，无内容则删除 |

### 字段级合并规则

| 字段                                     | 导入行为                                  |
| ---------------------------------------- | ----------------------------------------- |
| `id`, `title`, `description`, `sections` | **覆盖**（开发者维护）                    |
| `category_id`                            | **保留**（PM 在平台上维护，不受导入影响） |
| 文档状态、指派、编辑时间                 | **保留**（manual-tools 内部维护）         |

### 骨架变更后的 section 同步

导入检测到 sections 变更后，编辑器打开时提示：

- **新增 section**：提示插入模板，自动生成对应 Y.js 文档
- **移除 section**：提示 section 已删除，原内容转为"游离 section"
- **标题改名**：旧标题匹配不到新 section → 标记为"待确认"，人工处理

### 游离 section 处理

骨架移除了某个 section 后，其对应的 Y.js 文档不会自动删除，而是标记为"游离"状态：

**编辑器中的展示**：

- 游离 section 在左侧骨架进度树中显示为灰色删除线 + `⚠ 游离` 标记
- 内容仍可查看和编辑，但标题旁有提示"此章节已从骨架中移除"
- PM 可在编辑器中手动将游离内容合并到其他 section，然后删除

**导出行为**：

- 默认不参与导出（游离内容不出现在 PDF 中）
- Catalog 设置中可勾选"包含游离章节"（PM 临时恢复导出用）

**清理**：

- 功能列表页有"清理游离内容"入口，列出所有游离 section，PM 可批量删除
- 骨架导入时，若 PM 在 diff 确认中选了"删除骨架和内容"，则一并清理对应游离文档

---

## 五、协同编辑

### 技术方案

```
Y.js (CRDT)         → 冲突自动合并
y-websocket         → WebSocket 同步协议
TipTap              → 富文本编辑器（ProseMirror 内核，原生 Y.js 绑定）
better-sqlite3      → Y.js 文档持久化存储
```

- 多人同时编辑同一文档：Y.js CRDT 自动合并冲突
- 光标同步：Y.js Awareness 协议（类似飞书文档体验）
- 文档存储：Y.js update 流存入 SQLite，每个文档对应一张 update 记录表

### Y.js 存储与快照策略

每个文档的编辑操作以增量 update 形式追加存储。长期运行后 update 链会持续膨胀，影响文档加载速度和存储空间。

**快照合并机制**：

```
时间线：
snapshot₁ → update₁ → update₂ → update₃ → snapshot₂ → update₄ → ...
                                                    ↑
                                          Y.encodeStateAsUpdate()
                                          截断此前的 update 链
```

- **触发条件**：文档累计 update 数量超过阈值（默认 500 条）或距离上次快照超过 24 小时
- **合并过程**：用 `Y.encodeStateAsUpdate()` 生成当前完整状态的快照 → 存入 `document_snapshots` 表 → 删除该文档快照时间点之前的 update 记录
- **加载过程**：新客户端连接时加载最新快照 + 快照之后的增量 update → 恢复完整文档
- **阈值可配**：通过环境变量 `YJS_SNAPSHOT_UPDATE_THRESHOLD` 和 `YJS_SNAPSHOT_INTERVAL_HOURS` 调节
- **不影响协同**：快照生成在服务端后台执行，不阻塞编辑操作

### 编辑体验

```
运维 A 打开 target-track          运维 B 也打开同一文件
        │                                  │
        ├── WebSocket ──→ Server ←── WebSocket ──┤
        │                                  │
   编辑内容...                        编辑内容...
        │                                  │
        └──── Y.js CRDT 自动合并 ──────────┘
                  │
           两人实时看到彼此的编辑 + 光标位置
```

### 编辑器界面

左右分栏布局：

```
┌──────────────────┬───────────────────────────┐
│  功能骨架（只读）  │  TipTap 富文本编辑器        │
│                  │                           │
│  功能概述         │  所见即所得编辑区域          │
│  业务逻辑         │                           │
│  权限要求         │  工具栏：加粗/斜体/下划线/   │
│  后端服务         │  颜色/高亮/对齐/列表/待办/   │
│                  │  表格/图片/视频/链接/        │
│  编写进度：        │  交叉引用/查找替换/全屏     │
│  ├ ✅ 目标轨迹     │                           │
│  ├ 📝 光电视频     │  底部状态栏：词数/字符数/   │
│  └ ⏳ AIS         │  当前格式/在线用户          │
└──────────────────┴───────────────────────────┘
```

---

## 六、进度跟踪与审核链

### 状态定义

| 状态             | 含义         | 判定方式                    |
| ---------------- | ------------ | --------------------------- |
| `draft`          | 还没人动过   | 系统自动（Y.js 文档为空）   |
| `in_progress`    | 有编辑内容   | 系统自动（Y.js 文档有内容） |
| `completed`      | 运维认为完成 | 运维手动标记                |
| `pending_review` | 提交审核     | 运维提交后自动进入          |
| `approved`       | 审核通过     | PM 审核通过                 |
| `rejected`       | 审核驳回     | PM 驳回，附审核意见         |

### 审核链（Review Chain）

项目可配置多步审核流程（`review_chain` JSON 数组）。每一步审核被驳回时，文档回到 `in_progress`，审核日志（`review_log`）记录每次审核操作：

```json
[
  {
    "action": "approved",
    "reviewerId": "user1",
    "note": "内容无误",
    "step": 0,
    "created_at": "..."
  },
  {
    "action": "rejected",
    "reviewerId": "user2",
    "note": "需补充截图",
    "step": 1,
    "created_at": "..."
  }
]
```

### 状态粒度

状态挂在 **section 级别**，Feature 整体状态从 sections 推导：

```
Feature: 同步回放
├── section: target-track    → approved
├── section: video           → completed
├── section: radar           → in_progress
└── section: ais             → draft

Feature 整体 = in_progress（取最低状态）
全部 approved → 整体 approved
```

---

## 七、自定义功能

PM 可在 manual-tools 中直接创建功能，不来自代码导入。

### id 命名

```
代码导入：  waterway:sync-replay      （prefix:name）
PM 创建：   custom:faq                （custom:xxx）
```

`custom:` 是保留前缀，开发者不能使用。

### 属性对比

|                | 代码功能               | 自定义功能                |
| -------------- | ---------------------- | ------------------------- |
| 来源           | 代码导入               | manual-tools 创建         |
| 骨架可编辑     | 否，以导入为准         | 是，PM 可编辑删除         |
| sections       | 开发者定义，导入时覆盖 | PM 自由增删改，可拖拽排序 |
| 分类           | PM 手动分配            | PM 自由分配               |
| 删除           | 导入缺失时提示         | PM 随时删除（含内容）     |
| catalog 中显示 | 按分类分组             | 与代码功能混合显示        |

---

## 八、目录编排与导出

### 多 Catalog 模型

一个 catalog = 一个构建目标的操作手册，PM 编排一次，反复导出：

```
Catalogs:

  水域版操作手册        边检版操作手册        无人机版操作手册
  ────────────        ────────────        ────────────
  target: waterway    target: frontier     target: drone
  features:           features:            features:
    同步回放             出入境查验            飞行任务管理
    预警管理             行为配置              航线规划
    光电监视             同步回放             实时图传
    ...                 预警管理             设备管理
                        光电监视             ...
```

### 版本发布

每次导出/发布创建 `catalog_versions` 记录，存储完整快照：

- Markdown 内容和功能列表快照永久保留
- 支持语义化版本号（major.minor）
- `visibility` 控制访问级别：
  - `public` — 任何人可访问静态站点
  - `login_required` — 登录后可访问
  - `project_members` — 仅项目成员可访问

### 静态站点发布

发布时将 catalog 版本生成静态 HTML 站点到 `data/docs/{catalogId}/v{major}.{minor}/`。服务端中间件根据 `visibility` 和用户登录状态控制访问。

### 编排界面

```
┌────────────────────┬─────────────────────────────┐
│  可选功能           │  已编排功能（拖拽排序）         │
│                    │                             │
│  🔍 搜索...        │  1. 封面与版本说明            │
│                    │  2. 同步回放 ──── 水域监管   │
│  ▸ 水域监管         │  3. 预警管理 ──── 水域监管   │
│    ├ 同步回放       │  4. 光电监视 ──── 水域监管   │
│    ├ 预警管理       │  5. 出入境查验 ── 边检       │
│    └ 光电监视       │  6. 行为配置 ──── 边检       │
│  ▸ 边检            │                             │
│    ├ 出入境查验     │  拖入 = feature 整体进入       │
│    └ 行为配置       │  不可拆分 sections            │
│  ▸ 自定义           │                             │
│    ├ 常见问题       │                             │
│    └ 术语表         │                             │
└────────────────────┴─────────────────────────────┘
```

### 导出入口

两种方式：

| 方式                | 场景 | 说明                               |
| ------------------- | ---- | ---------------------------------- |
| 从 catalog 导出 PDF | 日常 | 复用编排，一键导出                 |
| 从 catalog 发布站点 | 分发 | 生成静态站点，支持 visibility 控制 |
| 快速导出            | 临时 | 选功能 → 排序 → 导出，不保存编排   |

---

## 九、PDF 导出

### 导出流程

```
前端发起导出请求
       │
       ▼
Fastify 服务：
  1. 读取 catalog → 拿到 features 列表 + 排序
  2. 遍历 features → 读取每个 section 的 Y.js 文档 → 生成 Markdown
  3. 按顺序组装完整 Markdown
  4. markdown-it 渲染为 HTML
  5. Puppeteer 打开 HTML → 生成 PDF
  6. 用 pdf-lib 注入 PDF 书签（大纲）
  7. 返回 PDF 文件流
```

### PDF 结构

```
┌─────────────────────────────────┐
│  封面                            │
│  水域监管系统操作手册              │
│  版本 v2.1  |  2026-06-22        │
├─────────────────────────────────┤
│  目录（自动生成）                  │
│  1. 同步回放................3     │
│    1.1 目标轨迹回放.........3     │
│    1.2 光电视频回放.........5     │
├─────────────────────────────────┤
│  正文                            │
│  每个 feature = 一章              │
│  每个 section = 一节              │
├─────────────────────────────────┤
│  页眉：系统名称 + 版本号           │
│  页脚：页码                      │
└─────────────────────────────────┘
```

### 未完成 section 处理

Catalog 设置中可选：

- **跳过**：未完成的 section 不出现
- **占位**：显示"（本章节暂未编写）"

---

## 十、技术栈

### 前端

| 层     | 选择                                   |
| ------ | -------------------------------------- |
| 框架   | Vue 3 + Vite                           |
| UI     | UnoCSS（不引入组件库）                 |
| 编辑器 | TipTap（ProseMirror 内核 + Y.js 绑定） |
| 路由   | Vue Router                             |
| 拖拽   | @vueuse/integrations + sortablejs      |
| 图标   | lucide-vue-next                        |

### 后端

| 层            | 选择                                                 |
| ------------- | ---------------------------------------------------- |
| 运行时        | Node.js 20+                                          |
| 框架          | Fastify                                              |
| WebSocket     | y-websocket                                          |
| 数据库        | better-sqlite3 + Drizzle ORM                         |
| Markdown 渲染 | markdown-it                                          |
| PDF 导出      | Puppeteer（puppeteer-core + 系统 Chromium）+ pdf-lib |
| 认证          | JWT（含 token_version）+ 飞书 OAuth                  |
| 通知          | 飞书机器人消息推送                                   |

### 项目结构

```
manual-tools/
├── package.json
├── pnpm-lock.yaml
├── eslint.config.js
├── vite.config.ts
├── uno.config.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── scripts/
│   └── example-features.json
├── data/                          # 持久化数据（volume 挂载）
│   ├── manual.db                  # SQLite
│   ├── uploads/
│   │   ├── images/                # 上传的截图
│   │   └── videos/                # 上传的视频
│   └── docs/                      # 发布的静态站点
├── src/                           # 前端
│   ├── App.vue
│   ├── main.ts
│   ├── router.ts
│   ├── api/
│   │   ├── client.ts              # HTTP 客户端
│   │   ├── transform.ts           # camelCase/snake_case 转换
│   │   └── endpoints/             # 按模块拆分
│   ├── components/
│   │   ├── AppLayout.vue          # 全局布局 + 项目选择器
│   │   ├── TiptapEditor.vue       # 富文本编辑器（含全工具栏+状态栏）
│   │   ├── ModalDialog.vue        # 通用对话框
│   │   ├── FormField.vue          # 表单字段（label + slot）
│   │   ├── ErrorMessage.vue       # 错误提示
│   │   ├── LoadingState.vue       # 加载状态
│   │   ├── EmptyState.vue         # 空状态
│   │   ├── StatusBadge.vue        # 状态标记
│   │   ├── PageHeader.vue         # 页面顶栏
│   │   ├── StatusTransitionModal.vue  # 状态流转弹窗
│   │   ├── SearchReplaceBar.vue   # 查找替换
│   │   ├── TableBubbleMenu.vue    # 表格浮动菜单
│   │   ├── TableGridPicker.vue    # 表格尺寸选择
│   │   ├── ColorPicker.vue        # 颜色选择器
│   │   ├── SelectDropdown.vue     # 可搜索下拉
│   │   ├── DialogContainer.vue    # 对话框挂载点
│   │   └── CrossrefPicker.vue     # 交叉引用选择器
│   ├── composables/
│   │   ├── useAuth.ts
│   │   ├── useProject.ts          # 项目状态管理
│   │   ├── useTiptapYjs.ts        # TipTap ↔ Y.js 绑定
│   │   ├── useYjsDoc.ts           # Y.js 文档连接
│   │   ├── cursor-awareness.ts    # 远程光标渲染
│   │   ├── useDialog.ts           # 对话框堆栈
│   │   ├── search-highlight.ts    # 查找高亮
│   │   ├── markdown-paste.ts      # Markdown 粘贴处理
│   │   ├── crossref-node.ts       # 交叉引用节点
│   │   └── video-node.ts          # 视频节点
│   └── views/
│       ├── login/
│       │   └── index.vue          # 登录页
│       ├── feature-list/
│       │   └── index.vue          # 功能列表（含创建/编辑/导入）
│       ├── feature-editor/
│       │   └── index.vue          # 编辑器（运维编写内容）
│       ├── catalog-builder/
│       │   └── index.vue          # 目录编排器
│       ├── manual-preview/
│       │   └── index.vue          # 手册预览 / 版本发布
│       ├── settings/
│       │   └── index.vue          # 设置页（项目管理 + 用户管理）
│       ├── profile/
│       │   └── index.vue          # 个人资料 + 飞书绑定
│       ├── todo-list/
│       │   └── index.vue          # 待办汇总
│       └── feishu-callback/
│           └── index.vue          # 飞书 OAuth 回调
├── server/                        # 后端
│   ├── index.ts                   # Fastify 入口（含文档站点访问控制）
│   ├── types.ts                   # 共享类型定义
│   ├── db/                        # Drizzle schema + 迁移
│   │   ├── index.ts               # initDatabase() + 迁移逻辑
│   │   ├── schema.ts
│   │   ├── migrate.ts
│   │   └── migrations/
│   ├── routes/
│   │   ├── projects.ts            # 项目 CRUD
│   │   ├── categories.ts          # 分类 CRUD
│   │   ├── features.ts            # 功能骨架（含导入）
│   │   ├── catalogs.ts            # 目录编排（含预览/导出/发布）
│   │   ├── yjs.ts                 # WebSocket 协同编辑
│   │   ├── auth.ts                # 认证 + 用户管理
│   │   ├── users.ts               # 用户管理 CRUD
│   │   ├── profile.ts             # 个人资料
│   │   ├── todos.ts               # 待办汇总
│   │   ├── upload.ts              # 图片/视频上传
│   │   └── feishu.ts              # 飞书绑定回调
│   ├── services/
│   │   ├── yjs-doc.ts             # Y.js 文档持久化
│   │   ├── pdf-generator.ts       # Markdown → HTML → PDF
│   │   ├── site-builder.ts        # 静态站点生成
│   │   ├── markdown-export.ts     # Markdown 导出
│   │   ├── notifications.ts       # 飞书消息通知
│   │   └── feishu.ts              # 飞书 API 客户端
│   └── auth/
│       ├── feishu.ts              # 飞书 OAuth
│       ├── jwt.ts                 # JWT 签发/验证
│       ├── middleware.ts          # 认证中间件 + 角色守卫
│       └── membership.ts          # 项目成员检查
└── healthcheck.js
```

### 核心页面

| 页面     | 路由                 | 功能                                     | 权限                  |
| -------- | -------------------- | ---------------------------------------- | --------------------- |
| 功能列表 | `/features`          | 骨架管理、状态总览、导入导出、按项目过滤 | 所有人可见，PM 可编辑 |
| 编辑器   | `/features/:id/edit` | 左侧骨架（只读）+ 右侧 TipTap 编辑       | 指派人 + PM 可编辑    |
| 目录编排 | `/catalogs/:id`      | 左侧可选功能 + 右侧拖拽编排，按项目过滤  | PM 专属               |
| 手册预览 | `/preview/:id`       | 完整手册渲染、PDF 导出、版本发布         | PM 专属               |
| 设置     | `/settings`          | 项目管理（CRUD）+ 用户管理               | PM 专属               |
| 个人资料 | `/profile`           | 当前用户信息 + 飞书绑定                  | 已登录                |
| 待办     | `/todos`             | 我的待办文档汇总                         | 已登录                |

---

## 十一、角色与权限

### 认证方式

**主方案：飞书 OAuth**

```
用户打开 manual-tools
       │
       ▼
  未登录 → 跳转飞书 OAuth 授权页
       │
       ▼
  飞书回调 → 换取 access_token + open_id
       │
       ▼
  调用 contact.user.get(open_id) → 获取姓名、部门、头像
       │
       ▼
  角色判定（配置名单优先 → 部门映射兜底）
       │
       ▼
  签发 JWT（含 userId, role, tokenVersion）→ 前端持有
```

**降级方案：本地账号 + JWT**

当飞书应用未审核通过或飞书服务不可用时：

- 通过环境变量 `AUTH_MODE=local` 切换为本地账号模式
- PM 通过管理员账号（环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 配置）登录后，在设置页创建其他用户的本地账号
- 登录接口 `/api/auth/login` 验证用户名密码 → 签发 JWT
- JWT 格式与飞书模式一致，前端和中间件无需感知认证来源

**JWT 安全机制：token_version**

- 每个用户有 `token_version` 整数字段
- 签名 JWT 时携带当前 `token_version`
- authMiddleware 验证时比对 JWT 中的版本与数据库当前版本
- 角色变更或密码修改时递增 `token_version`，所有旧 token 立即失效

**开发阶段：Token 占位**

通过环境变量 `AUTH_MODE=dev` 跳过认证，前端在登录页直接输入姓名 + 选择角色进入系统。仅在本地开发和内网测试环境使用。

### 角色定义

| 角色 | 来源                        | 判定方式                     |
| ---- | --------------------------- | ---------------------------- |
| PM   | 飞书通讯录部门 / 管理员指定 | 先查配置名单 → 再按部门映射  |
| 运维 | 飞书通讯录部门 / 默认       | 同上                         |
| 访客 | 管理员指定                  | 只读访问，仅查看已发布文档   |
| 开发 | 不需要登录 manual-tools     | 在项目源码中维护 features.ts |

### 权限矩阵

| 操作                     | 运维 | PM  | 访客 |
| ------------------------ | ---- | --- | ---- |
| 查看功能列表             | ✅   | ✅  | ✅   |
| 编辑自己指派的功能       | ✅   | ✅  | ❌   |
| 编辑他人指派的功能       | 只读 | ✅  | ❌   |
| 导入骨架                 | ❌   | ✅  | ❌   |
| 新增/编辑/删除自定义功能 | ❌   | ✅  | ❌   |
| 管理分类                 | ❌   | ✅  | ❌   |
| 创建/编辑/删除 catalog   | ❌   | ✅  | ❌   |
| 审核通过/驳回（改状态）  | ❌   | ✅  | ❌   |
| 导出 PDF / 发布站点      | ❌   | ✅  | ❌   |
| 查看已发布站点           | ✅   | ✅  | ✅   |

---

## 十二、飞书通知

通过 `server/services/notifications.ts` 和 `server/services/feishu.ts` 实现飞书机器人消息推送：

- **审核通知**：section 提交审核时发送消息给审核链中的 PM
- **指派通知**：运维被指派 section 时收到通知
- **驳回通知**：section 被驳回时通知编辑者
- **版本发布通知**：catalog 新版本发布时通知项目成员

通知内容包含文档标题、状态变更、操作人等信息，通过飞书自定义机器人 Webhook 发送。

---

## 十三、部署

### 镜像体积说明

`node:20-slim` + Chromium + 中文字体打包后镜像约 1.2GB。对于内网 3-5 人使用的工具在可接受范围内。若后续有瘦身需求，可拆 PDF 导出为独立 sidecar 容器，主服务使用 `node:20-alpine`（约 200MB）。

### Docker 方案

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium fonts-noto-cjk sqlite3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 3000

CMD ["node", "server/index.js"]
```

```yaml
# docker-compose.yml
services:
  manual-tools:
    image: manual-tools:latest
    container_name: manual-tools
    build: .
    ports:
      - '3000:3000'
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/app/data/manual.db
      - UPLOAD_DIR=/app/data/uploads
      - DOCS_DIR=/app/data/docs
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
      - FEISHU_REDIRECT_URI=${FEISHU_REDIRECT_URI}
    restart: unless-stopped
    mem_limit: 2g
```

### 更新流程

```bash
git pull
docker compose build
docker compose up -d --force-recreate
```

### 上传限制

- 图片：单文件上限 10MB（环境变量 `UPLOAD_MAX_SIZE` 可配），支持 PNG、JPG、GIF、WebP
- 视频：单文件上限 100MB（环境变量 `VIDEO_MAX_SIZE` 可配），支持 MP4、WebM

---

## 十五、实施顺序

| 序号 | 步骤                                                                                                                     | 状态    |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1    | 新建 manual-tools 仓库 + 项目骨架                                                                                        | ✅ 完成 |
| 2    | SQLite + Drizzle schema（projects, categories, features, documents, catalogs, catalog_versions, users, project_members） | ✅ 完成 |
| 3    | y-websocket + TipTap 编辑器                                                                                              | ✅ 完成 |
| 4    | 占位认证（AUTH_MODE=dev）                                                                                                | ✅ 完成 |
| 5    | 功能列表页 + 骨架导入（diff 确认）                                                                                       | ✅ 完成 |
| 6    | 目录编排器（拖拽）                                                                                                       | ✅ 完成 |
| 7    | 手册预览 + Puppeteer PDF 导出                                                                                            | ✅ 完成 |
| 8    | 飞书 OAuth 登录 + 角色判定 + 本地账号降级                                                                                | ✅ 完成 |
| 9    | 多项目支持                                                                                                               | ✅ 完成 |
| 10   | Y.js 快照合并策略实现                                                                                                    | ✅ 完成 |
| 11   | Docker 部署脚本                                                                                                          | ✅ 完成 |
| 12   | 前端组件提取（16 个通用组件）                                                                                            | ✅ 完成 |
| 14   | TypeScript 严格模式 + ESLint（零 any）                                                                                   | ✅ 完成 |
| 15   | 分类系统（categories 替代 module）                                                                                       | ✅ 完成 |
| 16   | 审核链 + 状态流转（pending_review, rejected）                                                                            | ✅ 完成 |
| 17   | 飞书通知集成                                                                                                             | ✅ 完成 |
| 18   | 静态站点发布 + visibility 访问控制                                                                                       | ✅ 完成 |
| 19   | 编辑器增强（查找替换/颜色/全屏/待办/对齐/视频等）                                                                        | ✅ 完成 |
| 20   | 交叉引用 + 光标持久化                                                                                                    | ✅ 完成 |
