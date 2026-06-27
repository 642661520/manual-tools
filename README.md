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

初次启动会自动创建 `default` 项目和数据库表。

### Docker 部署

```bash
# 复制环境变量配置
cp .env.example .env
# 编辑 .env 设置 JWT_SECRET 等

# 启动
docker compose up -d
```

服务运行在 `http://localhost:3000`。

## 功能概览

- **多项目管理** — 多项目隔离，每个项目独立的分类、功能和目录
- **功能骨架** — JSON 代码导入 + PM 自定义创建，按分类管理
- **Y.js 协同编辑** — 多人实时编辑，增量更新 + 快照存储，支持光标感知
- **审核流程** — 可配置的多步审核链（draft → in_progress → pending_review → approved）
- **目录编排** — 拖拽排序，搜索 + 分类筛选
- **静态站点发布** — 语义化版本号 (major.minor)，三种可见性（public / login_required / project_members），内建版本切换器
- **全文搜索** — 基于 SQLite FTS5 的项目内全文搜索
- **飞书集成** — OAuth 登录绑定、机器人消息通知
- **数据导入导出** — 项目级 ZIP 导出/导入，系统级数据库备份
- **AI 写作助手** — 基于 OpenAI 兼容 API 的智能写作辅助
- **版本对比** — 文档历史版本 diff 比较

## 项目结构

```
manual-tools/
├── server/
│   ├── index.ts              # Fastify 入口，插件注册、路由挂载
│   ├── routes/               # API 路由 (12 个模块)
│   │   ├── auth.ts           # 认证：登录 / JWT 签发
│   │   ├── projects.ts       # 项目 CRUD
│   │   ├── features.ts       # 功能骨架管理 + 导入
│   │   ├── catalogs.ts       # 目录编排 + 预览 + 发布
│   │   ├── categories.ts     # 分类管理
│   │   ├── yjs.ts            # Y.js WebSocket 协同编辑
│   │   ├── users.ts          # 用户管理
│   │   ├── profile.ts        # 个人资料 + 飞书绑定
│   │   ├── todos.ts          # 待办汇总
│   │   ├── upload.ts         # 图片/视频上传
│   │   ├── data-tasks.ts     # 数据导入导出
│   │   ├── ai.ts             # AI 写作助手
│   │   ├── search.ts         # 全文搜索
│   │   ├── diff.ts           # 版本对比
│   │   ├── audit.ts          # 审计日志
│   │   ├── log.ts            # 前端日志上报
│   │   └── cache.ts          # 缓存管理
│   ├── services/             # 业务逻辑层
│   │   ├── yjs-doc.ts        # Y.js 文档缓存与持久化
│   │   ├── manual-assembler.ts  # Markdown 手册组装
│   │   ├── site-builder/     # 静态站点生成器
│   │   ├── export-service.ts # 项目导出服务
│   │   ├── import-service.ts # 项目导入服务
│   │   ├── upload-cleaner.ts # 孤儿文件清理
│   │   ├── markdown-export.ts # Markdown 导出
│   │   ├── search.ts         # 全文搜索索引
│   │   └── notifications.ts  # 飞书消息通知
│   ├── auth/                 # 认证模块 (JWT / 中间件 / 飞书 OAuth)
│   └── db/                   # 数据库初始化 + Schema
├── src/
│   ├── views/                # 页面视图 (9 个)
│   │   ├── login/            # 登录
│   │   ├── feature-list/     # 功能列表（PM 管理）
│   │   ├── feature-editor/   # 运维编写（TipTap 编辑器）
│   │   ├── catalog-builder/  # 目录编排（PM）
│   │   ├── manual-preview/   # 手册预览 + 发布
│   │   ├── settings/         # 项目 + 用户管理
│   │   ├── profile/          # 个人资料
│   │   ├── todo-list/        # 待办列表
│   │   └── feishu-callback/  # 飞书 OAuth 回调
│   ├── components/           # 共享组件 (16 个)
│   ├── composables/          # 组合式函数 (10 个)
│   ├── api/                  # HTTP 客户端 + 端点模块
│   └── router.ts             # 路由配置 (11 条)
└── shared/types/             # 前后端共享类型
```

## 开发命令

| 命令              | 说明                                |
| ----------------- | ----------------------------------- |
| `pnpm dev`        | 前端 Vite dev server (port 5173)    |
| `pnpm server`     | 后端 Fastify (port 3000, tsx watch) |
| `pnpm build`      | 生产构建（类型检查 + Vite 打包）    |
| `pnpm lint`       | ESLint 检查                         |
| `pnpm lint:fix`   | ESLint 自动修复                     |
| `pnpm typecheck`  | 前后端一起类型检查                  |
| `pnpm test`       | 运行测试 (vitest)                   |
| `pnpm test:watch` | 测试 watch 模式                     |

## 环境变量

| 变量                | 说明                                    | 默认值           |
| ------------------- | --------------------------------------- | ---------------- |
| `NODE_ENV`          | 运行模式 (`production` / `development`) | `development`    |
| `DATABASE_PATH`     | SQLite 数据库路径                       | `data/manual.db` |
| `PORT`              | 服务端口                                | `3000`           |
| `JWT_SECRET`        | JWT 签名密钥                            | 生产环境必须设置 |
| `CORS_ORIGIN`       | CORS 额外白名单（逗号分隔）             | —                |
| `FEISHU_APP_ID`     | 飞书应用 ID                             | —                |
| `FEISHU_APP_SECRET` | 飞书应用密钥                            | —                |
| `ADMIN_USERNAME`    | 初始管理员用户名                        | `admin`          |
| `ADMIN_PASSWORD`    | 初始管理员密码                          | `admin123`       |

## 用户角色

| 角色     | 权限                                                      |
| -------- | --------------------------------------------------------- |
| `admin`  | 全局管理：项目管理、用户管理、所有内容读写                |
| `member` | 项目成员：可被指定为 PM（项目管理）或 writer（内容编写）  |
| `guest`  | 访客：仅浏览，限 `public` / `login_required` 可见性的文档 |

## 文档可见性

发布静态站点时支持三种可见性级别：

- **public** — 任何人可访问（无需登录）
- **login_required** — 登录用户可访问
- **project_members** — 仅项目成员可访问

## License

MIT
