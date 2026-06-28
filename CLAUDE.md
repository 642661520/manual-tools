# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
pnpm dev                  # 前端 Vite dev server (port 5173)
pnpm server               # 后端 Fastify (port 3000, tsx watch)
pnpm build                # 生产构建 (vue-tsc + Vite)
pnpm start                # 生产启动
pnpm lint                 # ESLint
pnpm lint:fix             # ESLint 自动修复
pnpm format               # oxfmt 格式化
pnpm format:check         # oxfmt 格式检查 (CI 用)
pnpm typecheck            # 前后端类型检查
pnpm typecheck:server     # 仅后端 tsc
pnpm typecheck:frontend   # 仅前端 vue-tsc
pnpm test                 # Vitest 测试
pnpm test:watch           # Vitest 监听模式
pnpm test:coverage        # Vitest 覆盖率报告
pnpm seed                 # 强制重新导入种子数据
pnpm seed:export          # 回写数据库文档内容到种子文件
pnpm seed:sync            # seed:export + seed 串联执行
pnpm docker:build         # Docker 构建
pnpm docker:up            # Docker Compose 启动
pnpm docker:down          # Docker Compose 停止
```

## Architecture

操作手册编写平台，支持多项目独立管理。Vue 3 前端 + Fastify 后端，单进程运行，SQLite (better-sqlite3) 持久化，Y.js CRDT 协同编辑。

### Data Model

```
projects → categories → features → documents (Y.js 协同编辑)
    └── catalogs → catalog_versions → 静态站点发布
```

- `projects` — 多项目隔离，含 `review_chain` JSON 配置多步审批流程，default 项目不可删除
- `categories` — 功能分类 (`name, color, sort_order`)，按项目隔离
- `features` — 功能骨架 (`title, description, sections JSON, is_custom`)，支持代码导入 + 自定义创建
- `documents` + `document_updates` + `document_snapshots` — Y.js CRDT 增量 + 快照存储，含审核字段。状态: `draft / in_progress / completed / pending_review / approved / rejected`
- `catalogs` — 目录编排，`features JSON` 按序引用 feature
- `catalog_versions` — 导出版本快照，含 markdown、visibility (`public / login_required / project_members`)、semver 版本号
- `users` — 含 `token_version`（角色/密码变更后旧 JWT 失效）、飞书绑定字段
- `project_members` — 项目成员关联表
- `data_tasks` — 异步任务管理（导入导出），24h 过期
- `audit_logs` — 操作审计日志

### Directory Map

```
server/
├── index.ts              # Fastify 入口，插件 + 路由注册
├── config.ts             # 集中配置（环境变量读取）
├── types.ts              # 共享类型定义
├── routes/ (18 modules)  # API 路由
├── services/ (15 modules)# 业务逻辑层
├── auth/ (5 modules)     # 认证模块
├── lib/ (6 modules)      # 工具库
├── db/                   # 数据库初始化 + schema + 种子数据
└── __tests__/            # 后端测试

src/
├── router.ts             # 路由定义 (13 条)
├── api/ (17 modules)     # HTTP 客户端 + 端点
├── components/ (27)      # 共享组件
├── composables/ (11)     # 组合式函数
├── views/ (9)            # 页面视图
├── utils/                # 工具函数
└── directives/           # 自定义指令

shared/                   # 前后端共享类型和工具
```

### Key Conventions

- **表单校验**: `errorRef` + `ErrorMessage` 组件模式，按钮不做 `:disabled` 阻止，靠函数内校验
- **TypeScript**: 禁止 `any`，DB 查询用 `as FeatureRow` 断言，catch 用 `e: unknown` + 类型守卫
- **图标**: 仅使用 `i-lucide-*` CSS class（UnoCSS presetIcons），禁止 emoji/Unicode/纯文本图标
- **样式**: UnoCSS shortcuts (`.btn`, `.btn-primary`, `.card`, `.input`, `.label` 等)，不引入组件库
- **项目上下文**: 后端 `?projectId=` 过滤，前端 `useProject()` 管理，`watch(projectId)` 自动刷新
- **WebSocket**: 使用 `WsSocket` (import from 'ws') 避免与 Node 全局 WebSocket 冲突

### Further Reading

详细模块目录请参阅:

- [docs/backend.md](docs/backend.md) — 路由、服务、认证、工具库
- [docs/frontend.md](docs/frontend.md) — 组件、组合式函数、页面视图、API 端点
- [docs/shared.md](docs/shared.md) — 前后端共享类型定义
- [docs/server-startup.md](docs/server-startup.md) — Server 启动流程与中间件链
- [docs/conventions.md](docs/conventions.md) — 设计系统、图标规范、编码约定
- [docs/env.md](docs/env.md) — 环境变量配置参考
- [docs/seed.md](docs/seed.md) — 种子数据系统（初始化内容、开发工作流）
- [docs/testing.md](docs/testing.md) — 测试体系与编写指南
