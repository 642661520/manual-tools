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

### 三层数据模型 + 项目层

```
projects → features → documents (Y.js 协同编辑)
    └── catalogs → PDF 导出
```

- `projects` — 多项目隔离。初次启动自动创建 `default` 项目并迁移旧数据
- `features` — 功能骨架，含 `id, title, module, sections(JSON), project_id`。代码导入 + PM 自定义创建
- `documents` + `document_updates` + `document_snapshots` — Y.js CRDT 协同编辑，每 section 一个文档，增量 + 快照存储
- `catalogs` — 目录编排，含 `features(JSON 数组)` 引用 feature id 有序列表，PDF 导出时按此顺序组装

### 后端 (server/)

- `server/index.ts` — Fastify 入口，注册所有路由和插件 (cors, websocket, multipart, static)
- `server/db/index.ts` — `initDatabase()` 用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` 做幂等迁移，`columnExists()` 检查列是否存在
- `server/types.ts` — 所有共享类型（DB 行类型、请求体类型、PDF 生成类型、飞书 API 响应类型）
- `server/routes/` — 每个文件导出一个 `async function xxxRoutes(app)`，注册为 Fastify plugin
  - `projects.ts` — 项目 CRUD（PM only，default 不可删除，删除时级联清理 features + catalogs）
  - `features.ts` — 功能列表支持 `?projectId=` 过滤，`POST /api/features` 创建自定义功能，`/import` + `/import/apply` 做 JSON 骨架导入的差异检测和合并
  - `catalogs.ts` — 目录 CRUD + `/preview`（返回 Markdown 数据）+ `/export`（Puppeteer PDF 生成）
  - `yjs.ts` — WebSocket `/ws/doc/:docId`，Y.js sync protocol + awareness 协议，使用 `WsSocket` (import from 'ws') 避免与 Node 全局 WebSocket 类型冲突
  - `auth.ts` — 登录 + JWT 签发 + 本地用户管理
- `server/services/yjs-doc.ts` — 内存 DocState 缓存，`getOrCreateDoc()` 懒加载并持久化 Y.js update 到 SQLite
- `server/services/pdf-generator.ts` — `assembleManual()` 按 catalog 中 feature 列表读取 Y.js 文档内容组装 Markdown → `generateHtml()` → `addPdfOutline()` 添加 PDF 书签
- `server/auth/middleware.ts` — `authMiddleware` 校验 JWT，`requireRole(...roles)` 返回角色守卫
- `server/auth/feishu.ts` — 飞书 OAuth 骨架（待应用审核通过后启用）

### 前端 (src/)

- `src/router.ts` — 所有路由：`/login`, `/features`, `/features/:id/edit`, `/catalogs/:id`, `/catalogs/:id/preview`, `/settings`
- `src/components/AppLayout.vue` — 全局布局，顶部 nav + 项目选择器（从 `useProject()` 读取）
- `src/composables/useAuth.ts` — 模块级 reactive refs，login/logout/token 管理
- `src/composables/useProject.ts` — 模块级单例，localStorage 持久化 `active_project_id`，提供 `switchProject()` / `loadProjects()`
- `src/composables/useYjsDoc.ts` — 客户端 Y.js doc + WebSocket 连接，sync step 握手 + update 广播 + awareness 收发
- `src/composables/useTiptapYjs.ts` — TipTap editor 绑定到 Y.js `ytext('content')`，本地编辑→Y.js 同步，远程更新→editor dispatch
- `src/composables/cursor-awareness.ts` — TipTap Extension，渲染远程用户光标位置
- `src/views/feature-list/` — PM 集中管理页面：创建/编辑/删除自定义功能、导入 JSON 骨架（diff 确认界面）、功能分组展示和状态总览
- `src/views/feature-editor/` — 运维纯编写页面：左侧只读导航树 + 右侧 TipTap 编辑器
- `src/views/catalog-builder/` — PM 编排：左侧可选功能池（搜索+按 module 分组）+ 右侧拖拽排序已选功能
- `src/views/settings/` — PM 设置：当前用户信息 + 项目管理 CRUD + 本地账号管理
- `src/views/login/` — 登录页，支持用户名密码登录和飞书 OAuth 登录
- `src/views/manual-preview/` — 手册预览 + PDF 导出按钮

### 共享组件 (src/components/)

| 组件 | 用途 |
|------|------|
| `ModalDialog` | 通用对话框，props: visible/title/confirmText/cancelText/error/loading/widthClass |
| `FormField` | 表单字段 label+slot，props: label/required |
| `ErrorMessage` | 红色错误提示框，prop: message |
| `LoadingState` | 居中加载状态，prop: message |
| `EmptyState` | 空态占位，props: icon/title/description |
| `StatusBadge` | 状态标记 `draft/in_progress/completed/approved`，variant: badge 或 text |
| `PageHeader` | 页面顶栏，slots: #left / #right |
| `TiptapEditor` | 富文本编辑器 + 图片上传 |

### UnoCSS 设计系统

自定义 shortcuts（在 `uno.config.ts`）: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card`, `.input`, `.label`。全局使用这些 shortcuts 保持样式一致，不引入组件库。

### 项目上下文传递

后端通过 query 参数 `?projectId=xxx` 过滤 features 和 catalogs。前端 `useProject()` composable 管理当前项目，受影响的视图通过 `watch(currentProjectId, reloadData)` 自动刷新。Y.js 和 PDF 管道不受项目影响（feature ID 全局唯一）。

### 表单校验模式

所有表单使用统一的 `errorRef` + `ErrorMessage` 组件模式。按钮不做 `:disabled` 阻止点击（会导致错误提示永远不显示），而是靠函数内校验显示错误信息。三步校验：前端空值/格式检查 → API 响应 `body.error` → catch 网络异常。

### TypeScript 规范

- 禁止 `any`，ESLint 规则 `@typescript-eslint/no-explicit-any: error`
- 所有 DB 查询结果使用 `as FeatureRow`, `as CatalogRow` 等明确类型断言（来自 `server/types.ts`）
- Y.js `origin` 参数用 `unknown`
- catch 块用 `e: unknown` + `e instanceof Error` 类型守卫
- WebSocket 类型使用 `import type { WebSocket as WsSocket } from 'ws'` 避免与 Node 全局 WebSocket 冲突
