# 操作手册编写平台 (Manual Tools)

多项目操作手册编写与发布平台，支持 Y.js 协同编辑、审核流程、目录编排和静态站点发布。

## 技术栈

| 层级         | 技术                               |
| ------------ | ---------------------------------- |
| 前端         | Vue 3 + TypeScript + Vite + UnoCSS |
| 后端         | Fastify 5 + TypeScript             |
| 数据库       | SQLite (better-sqlite3)            |
| 协同编辑     | Y.js + WebSocket                   |
| 富文本编辑器 | TipTap 3                           |
| 测试         | Vitest                             |
| 部署         | Docker / pnpm + tsx                |

## 快速开始

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动后端 (port 3000)
pnpm server

# 启动前端 dev server (port 5173)
pnpm dev
```

初次启动会自动创建 `default` 项目、数据库表和种子操作手册内容。

### Docker 部署

```bash
# 复制环境变量配置
cp .env.example .env
# 编辑 .env 设置 JWT_SECRET 等

# 构建并启动
pnpm docker:up
```

## 功能概览

- **多项目管理** — 多项目隔离，每个项目独立的分类、功能和目录
- **功能骨架** — JSON 代码导入 + PM 自定义创建，按分类管理
- **Y.js 协同编辑** — 多人实时编辑，增量更新 + 快照存储，光标感知
- **审核流程** — 可配置的多步审核链（draft → in_progress → completed → pending_review → approved / rejected）
- **目录编排** — 拖拽排序，Part 分区，搜索 + 分类筛选
- **静态站点发布** — 语义化版本号，三种可见性（public / login_required / project_members），版本切换器 + `/latest/` 跳转
- **全文搜索** — SQLite FTS5 全文搜索，索引自动维护
- **AI 写作助手** — OpenAI 兼容接口（润色/总结/修复/扩充/自定义指令）
- **飞书集成** — OAuth 登录绑定、机器人消息通知
- **PDF 导出** — Puppeteer 渲染 PDF（支持中文字体配置）
- **版本对比** — 已发布版本的 Markdown 逐行 diff
- **数据导入导出** — 项目级 ZIP 导出/导入（差异分析 + 冲突处理）
- **审计日志** — 操作记录追溯，按用户/操作/目标类型筛选
- **缓存管理** — 导出缓存 + 远程资源缓存，自动过期清理
- **API 文档** — Swagger UI（`/docs/api`，需登录）

## 项目结构

```
manual-tools/
├── server/
│   ├── index.ts              # Fastify 入口（插件注册、路由挂载、访问控制）
│   ├── config.ts             # 集中配置模块
│   ├── types.ts              # 服务端类型定义
│   ├── routes/               # API 路由 (18 个模块)
│   │   ├── auth.ts           # 认证：登录 / JWT 签发 / 注册
│   │   ├── projects.ts       # 项目 CRUD
│   │   ├── features.ts       # 功能骨架管理 + JSON 导入
│   │   ├── catalogs.ts       # 目录编排 + 预览 + 发布
│   │   ├── categories.ts     # 分类管理
│   │   ├── yjs.ts            # Y.js WebSocket 协同编辑
│   │   ├── users.ts          # 用户管理
│   │   ├── profile.ts        # 个人资料 + 飞书绑定 + 通知偏好
│   │   ├── todos.ts          # 待办汇总
│   │   ├── upload.ts         # 图片/视频上传
│   │   ├── data-tasks.ts     # 数据导入导出
│   │   ├── ai.ts             # AI 辅助写作
│   │   ├── search.ts         # 全文搜索
│   │   ├── diff.ts           # 版本对比
│   │   ├── audit.ts          # 审计日志
│   │   ├── cache.ts          # 缓存管理
│   │   ├── log.ts            # 前端错误上报
│   │   └── feishu.ts         # 飞书 OAuth 回调
│   ├── services/             # 业务逻辑层 (15 个模块)
│   │   ├── yjs-doc.ts        # Y.js 文档缓存与持久化
│   │   ├── manual-assembler.ts  # Markdown 手册组装
│   │   ├── site-builder/     # 静态站点生成器
│   │   ├── export-service.ts # 项目导出
│   │   ├── import-service.ts # 项目导入
│   │   ├── upload-cleaner.ts # 孤儿文件清理
│   │   ├── search.ts         # FTS5 搜索引擎
│   │   ├── ai-assistant.ts   # AI 写作
│   │   ├── pdf-export.ts     # PDF 导出
│   │   ├── audit.ts          # 审计日志
│   │   ├── notifications.ts  # 飞书消息通知
│   │   ├── feishu.ts         # 飞书 API 客户端
│   │   ├── export-cache.ts   # 导出缓存管理
│   │   ├── remote-cache.ts   # 远程资源缓存
│   │   └── markdown-export.ts # Markdown 文件导出
│   ├── auth/                 # 认证模块
│   │   ├── middleware.ts     # JWT 校验 + 角色守卫
│   │   ├── jwt.ts            # 签名 / 验签
│   │   ├── feishu.ts         # 飞书 OAuth
│   │   ├── membership.ts     # 项目成员检查
│   │   └── token.ts          # Token 提取
│   ├── lib/                  # 工具库
│   │   ├── logger.ts         # Pino 结构化日志
│   │   ├── response.ts       # 统一 API 响应格式
│   │   ├── password.ts       # 密码强度校验
│   │   ├── csrf.ts           # CSRF 保护
│   │   ├── crypto.ts         # 安全随机数
│   │   └── swagger.ts        # OpenAPI 文档
│   ├── db/                   # 数据库初始化 + Schema + 种子数据
│   └── __tests__/            # 后端测试
├── src/
│   ├── views/                # 页面视图 (9 个)
│   │   ├── login/            # 登录
│   │   ├── feature-list/     # 功能列表
│   │   ├── feature-editor/   # 编辑器（TipTap + AI 面板）
│   │   ├── catalog-builder/  # 目录编排
│   │   ├── manual-preview/   # 手册预览 + 发布
│   │   ├── settings/         # 设置（项目/用户/审计/数据管理）
│   │   ├── profile/          # 个人资料
│   │   ├── todo-list/        # 待办列表
│   │   └── feishu-callback/  # 飞书 OAuth 回调
│   ├── components/           # 共享组件 (23 个 + 4 编辑器子组件)
│   ├── composables/          # 组合式函数 (11 个)
│   ├── api/                  # HTTP 客户端 + 端点模块 (14 个)
│   ├── router.ts             # 路由配置 (13 条)
│   ├── utils/                # 工具函数
│   └── directives/           # 自定义指令
└── shared/                   # 前后端共享类型定义
    ├── types/models.ts       # 领域模型
    ├── types/api.ts          # API 响应类型
    ├── types/requests.ts     # 请求体类型
    └── utils/sections.ts     # Section 工具
```

## 开发命令

| 命令                 | 说明                                |
| -------------------- | ----------------------------------- |
| `pnpm dev`           | 前端 Vite dev server (port 5173)    |
| `pnpm server`        | 后端 Fastify (port 3000, tsx watch) |
| `pnpm build`         | 生产构建（类型检查 + Vite 打包）    |
| `pnpm start`         | 生产启动                            |
| `pnpm lint`          | ESLint 检查                         |
| `pnpm lint:fix`      | ESLint 自动修复                     |
| `pnpm format`        | oxfmt 格式化                        |
| `pnpm format:check`  | oxfmt 格式检查                      |
| `pnpm typecheck`     | 前后端类型检查                      |
| `pnpm test`          | 运行测试 (Vitest)                   |
| `pnpm test:watch`    | 测试监听模式                        |
| `pnpm test:coverage` | 测试覆盖率报告                      |
| `pnpm seed`          | 强制重新导入种子数据                |
| `pnpm seed:export`   | 回写数据库文档到种子文件            |

## 环境变量

详见 [.env.example](.env.example) 和 [docs/env.md](docs/env.md)。

| 变量                | 说明                                    | 默认值           |
| ------------------- | --------------------------------------- | ---------------- |
| `NODE_ENV`          | 运行模式 (`production` / `development`) | `development`    |
| `PORT`              | 服务端口                                | `3000`           |
| `DATABASE_PATH`     | SQLite 数据库路径                       | `data/manual.db` |
| `JWT_SECRET`        | JWT 签名密钥                            | 生产环境必须设置 |
| `ADMIN_USERNAME`    | 初始管理员用户名                        | `admin`          |
| `ADMIN_PASSWORD`    | 初始管理员密码                          | `Admin@123`      |
| `FEISHU_APP_ID`     | 飞书应用 ID                             | —                |
| `FEISHU_APP_SECRET` | 飞书应用密钥                            | —                |
| `AI_BASE_URL`       | AI API 地址（OpenAI 兼容）              | —                |
| `AI_API_KEY`        | AI API 密钥                             | —                |

完整配置项见 [docs/env.md](docs/env.md)。

## 文档

项目架构和开发指引详见：

- [docs/backend.md](docs/backend.md) — 后端路由、服务、认证、工具库
- [docs/frontend.md](docs/frontend.md) — 前端组件、组合式函数、页面视图
- [docs/conventions.md](docs/conventions.md) — 设计系统、编码约定
- [docs/env.md](docs/env.md) — 环境变量配置参考
- [docs/seed.md](docs/seed.md) — 种子数据系统
- [docs/shared.md](docs/shared.md) — 前后端共享类型
- [docs/server-startup.md](docs/server-startup.md) — Server 启动流程
- [docs/testing.md](docs/testing.md) — 测试体系

## License

MIT
