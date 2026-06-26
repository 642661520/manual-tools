# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
pnpm dev                  # 前端 Vite dev server (port 5173)
pnpm server               # 后端 Fastify (port 3000, tsx watch)
pnpm build                # 生产构建 (类型检查 + Vite 打包)
pnpm lint                 # ESLint (no-explicit-any: error)
pnpm lint:fix             # ESLint 自动修复
pnpm typecheck            # 前后端一起类型检查
pnpm typecheck:server     # 仅后端 tsc -p tsconfig.node.json
pnpm typecheck:frontend   # 仅前端 vue-tsc
```

## Architecture

操作手册编写平台，支持多项目独立管理。Vue 3 前端 + Fastify 后端，单进程运行，SQLite 持久化。

### 数据模型

```
projects → categories → features → documents (Y.js 协同编辑)
    └── catalogs → catalog_versions → 静态站点发布
```

- `projects` — 多项目隔离。初次启动自动创建 `default` 项目并迁移旧数据。含 `review_chain` JSON 字段配置多步审批流程
- `categories` — 功能分类，含 `name, color, sort_order`，按项目隔离。替代旧 `module` 硬编码分组方式
- `features` — 功能骨架，含 `id, title, description, sections(JSON), is_custom, category_id, project_id`。代码导入 + PM 自定义创建
- `documents` + `document_updates` + `document_snapshots` — Y.js CRDT 协同编辑，每 section 一个文档，增量 + 快照存储。含 `status, assignees, review_note, review_step, review_log` 等审核字段。文档状态：`draft / in_progress / completed / pending_review / approved / rejected`
- `catalogs` — 目录编排，含 `features(JSON 数组)` 按顺序引用 feature id
- `catalog_versions` — 导出版本快照，含完整 markdown、features_snapshot、`visibility`（`public / login_required / project_members`）、版本号（major.minor）
- `users` — 含 `token_version` 字段，角色/密码变更后递增使旧 JWT 失效；支持飞书绑定（`feishu_open_id, feishu_name, feishu_avatar_url`）
- `project_members` — 项目成员关联表

### 后端 (server/)

- `server/index.ts` — Fastify 入口，注册所有插件 (cors, websocket, multipart, static) 和路由。生产环境提供 SPA fallback。文档站点 `/docs/` 按 visibility 和登录状态做访问控制
- `server/db/index.ts` — `initDatabase()` 用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` 做幂等迁移，`columnExists()` 检查列是否存在
- `server/db/schema.ts` — Drizzle ORM schema（12 表）
- `server/types.ts` — 所有共享类型（DB 行类型、请求体类型、飞书 API 响应类型）
- `server/routes/` — 每个文件导出一个 `async function xxxRoutes(app)`，注册为 Fastify plugin（12 个模块）：
  - `projects.ts` — 项目 CRUD（PM only，default 不可删除，删除时级联清理 features + catalogs）
  - `categories.ts` — 分类 CRUD，按项目隔离
  - `features.ts` — 功能列表支持 `?projectId=` 过滤，`POST /api/v1/features` 创建自定义功能，`/import` + `/import/apply` 做 JSON 骨架导入的差异检测和合并
  - `catalogs.ts` — 目录 CRUD + `/preview`（返回 Markdown 数据）+ `/publish`（发布静态站点版本）
  - `yjs.ts` — WebSocket `/ws/doc/:docId`，Y.js sync protocol + awareness 协议，使用 `WsSocket` (import from 'ws') 避免与 Node 全局 WebSocket 类型冲突
  - `auth.ts` — 登录 + JWT 签发 + 本地用户注册
  - `users.ts` — 用户管理 CRUD（PM only）
  - `profile.ts` — 当前用户资料查询/更新、飞书账号绑定
  - `todos.ts` — 当前用户待办汇总（指派给自己的文档）
  - `upload.ts` — 图片/视频上传到 `data/uploads/`（图片最大 10MB，视频最大 100MB）
  - `data-tasks.ts` — 数据导入导出：项目级导出/导入（ZIP，异步任务 + 进度轮询 + 流式下载）、系统级数据库备份、孤儿文件清理。`data_tasks` 表管理任务生命周期，24h 自动过期
  - `feishu.ts` — 飞书 OAuth 绑定回调
- `server/services/` — 服务层（6 个模块）：
  - `yjs-doc.ts` — 内存 DocState 缓存，`getOrCreateDoc()` 懒加载并持久化 Y.js update 到 SQLite
  - `manual-assembler.ts` — `assembleManual()` 按 catalog 中 feature 列表读取 Y.js 文档内容组装 Markdown（用于预览和导出）
  - `site-builder/` — 静态站点生成，`buildStaticSite()` 生成 HTML 到 `data/docs/`；模板/样式/脚本分离；内建版本切换器（按 visibility 权限过滤）+ `/latest/` 跳转
  - `export-service.ts` — 项目导出：收集数据 + 扫描上传引用 → `archiver` 流式生成 ZIP → `data/exports/`。`estimateExport()` 实时预估大小，`runExportTask()` 异步执行
  - `import-service.ts` — 项目导入：`unzipper` 解析 ZIP → `analyzeImport()` 差异分析 → `applyImport()` 事务写入 + 上传文件 SHA-256 去重复制
  - `upload-cleaner.ts` — 孤儿文件扫描：扫描所有 document BLOB 提取 `/uploads/` 引用 → 与磁盘文件差集 → `deleteOrphanFiles()` 清理
  - `markdown-export.ts` — Markdown 文件导出服务
  - `notifications.ts` — 飞书机器人消息通知（审核、指派等事件推送）
  - `feishu.ts` — 飞书 API 客户端（用户信息查询、消息发送）
- `server/auth/` — 认证模块：
  - `middleware.ts` — `authMiddleware` 校验 JWT（含 `token_version` 比对数据库，角色/密码变更后强制下线），`requireRole(...roles)` 返回角色守卫
  - `jwt.ts` — signToken / verifyToken，含 `tokenVersion` 载荷
  - `feishu.ts` — 飞书 OAuth 流程
  - `membership.ts` — `isProjectMember()` 项目成员检查

### 前端 (src/)

- `src/router.ts` — 11 条路由：
  - `/login` — 登录
  - `/features` — 功能列表（所有人可见，PM 可编辑）
  - `/features/:id/edit` — 编辑器（左侧导航树 + 右侧 TipTap）
  - `/catalogs/:id` — 目录编排（PM）
  - `/preview` / `/preview/:id` — 手册预览
  - `/settings` — 项目管理 + 用户管理（PM）
  - `/profile` — 个人资料 + 飞书绑定
  - `/todos` — 待办列表
  - `/feishu-callback` — 飞书 OAuth 回调
- `src/api/` — HTTP 客户端 + 端点模块
  - `client.ts` — 统一 fetch 封装，自动注入 token，统一错误处理
  - `transform.ts` — camelCase/snake_case 转换
  - `endpoints/` — `auth, projects, features, catalogs, categories, documents, todos, upload, data-tasks`
- `src/components/` — 共享组件（16 个）：

| 组件 | 用途 |
|------|------|
| `AppLayout` | 全局布局：顶部导航 + 项目选择器 + 用户菜单 |
| `TiptapEditor` | 富文本编辑器：TipTap + Y.js 绑定 + 全工具栏 + 底部状态栏 |
| `ModalDialog` | 通用对话框，props: visible/title/confirmText/cancelText/error/loading/widthClass |
| `FormField` | 表单字段 label+slot，props: label/required |
| `ErrorMessage` | 红色错误提示框，prop: message |
| `LoadingState` | 居中加载状态，prop: message |
| `EmptyState` | 空态占位，props: icon/title/description |
| `StatusBadge` | 状态标记 `draft/in_progress/completed/approved/rejected`，variant: badge 或 text |
| `PageHeader` | 页面顶栏，slots: #left / #right |
| `StatusTransitionModal` | 状态流转弹窗（含审核意见、指派人员、审核链显示） |
| `SearchReplaceBar` | 查找替换栏（查找/替换/全部替换/区分大小写） |
| `TableBubbleMenu` | 表格浮动菜单（行列增删/表头切换） |
| `TableGridPicker` | 表格尺寸选择器（行列数网格选取） |
| `ColorPicker` | 颜色选择器（文字颜色 10 色 + 背景高亮 10 色） |
| `SelectDropdown` | 可搜索下拉选择框 |
| `DialogContainer` | Teleported 对话框挂载点 |
| `CrossrefPicker` | 交叉引用选择器（选择目标 feature/section） |

- `src/composables/` — 组合式函数（10 个）：

| Composable | 用途 |
|------|------|
| `useAuth` | 模块级 reactive refs，login/logout/token 管理 |
| `useProject` | 模块级单例，localStorage 持久化 `active_project_id`，`switchProject()` / `loadProjects()` |
| `useYjsDoc` | 客户端 Y.js doc + WebSocket 连接，sync step 握手 + update 广播 + awareness 收发 |
| `useTiptapYjs` | TipTap editor 绑定到 Y.js `ytext('content')`，本地编辑→Y.js 同步，远程更新→editor dispatch |
| `cursor-awareness` | TipTap Extension，渲染远程用户光标位置 |
| `useDialog` | 对话框堆栈管理（alert/confirm/prompt） |
| `search-highlight` | 查找高亮 composable |
| `markdown-paste` | Markdown 粘贴处理 |
| `crossref-node` | 交叉引用 Node 定义（feature/section 内链） |
| `video-node` | 视频 Node 定义（video 类型节点） |

- `src/views/` — 页面视图（9 个）：
  - `login/` — 用户名密码登录 + 飞书 OAuth 登录
  - `feature-list/` — PM 集中管理：创建/编辑/删除自定义功能、导入 JSON 骨架（diff 确认界面）、按分类分组展示和状态总览
  - `feature-editor/` — 运维编写：左侧功能导航树 + 右侧 TipTap 编辑器，支持状态流转
  - `catalog-builder/` — PM 编排：左侧可选功能池（搜索+按分类分组）+ 右侧拖拽排序已选功能
  - `manual-preview/` — 手册预览 + 版本发布
  - `settings/` — PM 设置：项目管理 CRUD + 用户管理
  - `profile/` — 个人资料查看 + 飞书账号绑定
  - `todo-list/` — 我的待办汇总
  - `feishu-callback/` — 飞书 OAuth 回调处理

### UnoCSS 设计系统

自定义 shortcuts（在 `uno.config.ts`）: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card`, `.input`, `.label`。全局使用这些 shortcuts 保持样式一致，不引入组件库。

### 图标规范

**禁止使用文字图标**（emoji、Unicode 符号、纯文本字符作为图标）。项目使用 UnoCSS `presetIcons` + `@iconify-json/lucide` 作为统一图标方案。

**使用方式：**

```html
<span class="i-lucide-<icon-name> w-4 h-4 inline-block align-middle" />
```

- 所有图标通过 `i-lucide-*` CSS class 引用，UnoCSS 在构建时将图标内联为 SVG
- 图标尺寸统一使用 `w-4 h-4`（标准）或 `w-5 h-5`（较大），辅以 `inline-block align-middle` 对齐文字基线
- `extraProperties` 已全局设置 `display: inline-block; flex-shrink: 0; transform: translateY(-1px)`，使用时只需关注尺寸

**可用图标：** 在 [Iconify Lucide](https://icon-sets.iconify.design/lucide/) 搜索可用图标名称，使用 `i-lucide-<name>` 格式。

**禁止项：**
- ❌ emoji 作为图标：`💡`, `⚠️`, `✅`, `❌` 等
- ❌ Unicode 符号作为图标：`×`, `✓`, `→`, `…` 等
- ❌ 纯文本字符作为图标：`Aa`, `B`, `I`, `S`, `U`, `x₂`, `x²`, `H1`-`H6` 等
- ✅ 使用对应的 Lucide 图标：`i-lucide-lightbulb`, `i-lucide-alert-triangle`, `i-lucide-bold`, `i-lucide-italic`, `i-lucide-heading-1` 等

**文本提示中的辅助符号例外：** 在纯文本提示信息中（如 `<p>` 标签内的说明文字），可使用少量标点符号（如 `→`、`：`）辅助表达，但不得替代图标功能。

### 项目上下文传递

后端通过 query 参数 `?projectId=xxx` 过滤 features 和 catalogs。前端 `useProject()` composable 管理当前项目，受影响的视图通过 `watch(currentProjectId, reloadData)` 自动刷新。Y.js 和站点生成管道按 feature/catalog ID 全局唯一操作。

### 表单校验模式

所有表单使用统一的 `errorRef` + `ErrorMessage` 组件模式。按钮不做 `:disabled` 阻止点击（会导致错误提示永远不显示），而是靠函数内校验显示错误信息。三步校验：前端空值/格式检查 → API 响应 `body.error` → catch 网络异常。

### TypeScript 规范

- 禁止 `any`，ESLint 规则 `@typescript-eslint/no-explicit-any: error`
- 所有 DB 查询结果使用 `as FeatureRow`, `as CatalogRow` 等明确类型断言（来自 `server/types.ts`）
- Y.js `origin` 参数用 `unknown`
- catch 块用 `e: unknown` + `e instanceof Error` 类型守卫
- WebSocket 类型使用 `import type { WebSocket as WsSocket } from 'ws'` 避免与 Node 全局 WebSocket 冲突
