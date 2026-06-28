# 后端架构

## 路由模块 (server/routes/) — 18 个

每个文件导出一个 `async function xxxRoutes(app)`，注册为 Fastify plugin。

| 文件            | 路径前缀                    | 用途                                                                                                                                  |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `projects.ts`   | `/api/v1/projects`          | 项目 CRUD（PM only，default 不可删除，级联清理 features + catalogs）                                                                  |
| `categories.ts` | `/api/v1/categories`        | 分类 CRUD，按项目隔离                                                                                                                 |
| `features.ts`   | `/api/v1/features`          | 功能列表 `?projectId=` 过滤，创建自定义功能，`/import` + `/import/apply` JSON 骨架导入差异检测和合并                                  |
| `catalogs.ts`   | `/api/v1/catalogs`          | 目录 CRUD + `/preview`（返回 Markdown）+ `/publish`（发布静态站点版本）                                                               |
| `yjs.ts`        | `/ws/doc/:docId`            | WebSocket Y.js sync protocol + awareness，使用 `WsSocket` (from 'ws')                                                                 |
| `auth.ts`       | `/api/v1/auth`              | 登录 + JWT 签发 + 本地用户注册 + 飞书登录                                                                                             |
| `users.ts`      | `/api/v1/users`             | 用户管理 CRUD（PM only）                                                                                                              |
| `profile.ts`    | `/api/v1/profile`           | 当前用户资料查询/更新、飞书账号绑定、通知开关                                                                                         |
| `todos.ts`      | `/api/v1/todos`             | 当前用户待办汇总（指派给自己的文档）                                                                                                  |
| `upload.ts`     | `/api/v1/upload`            | 图片/视频上传到 `data/uploads/`（图片最大 10MB，视频最大 100MB）                                                                      |
| `data-tasks.ts` | `/api/v1/data`              | 项目级导出/导入（ZIP，异步任务 + 进度轮询 + 流式下载）、系统级数据库备份、孤儿文件清理。`data_tasks` 表管理任务生命周期，24h 自动过期 |
| `feishu.ts`     | `/api/v1/auth/feishu`       | 飞书 OAuth 绑定回调                                                                                                                   |
| `ai.ts`         | `/api/v1/ai`                | AI 辅助写作（润色/总结/修复/扩充/自定义），POST `/chat`                                                                               |
| `search.ts`     | `/api/v1/search`            | 全文搜索（FTS5），`GET /` 搜索 + `POST /rebuild` 重建索引（admin）                                                                    |
| `audit.ts`      | `/api/v1/audit-logs`        | 审计日志查询（admin only），按 userId/action/targetType 过滤分页                                                                      |
| `diff.ts`       | `/api/v1/catalogs/:id/diff` | 两个发布版本的 Markdown 逐行 diff（`?v1=old&v2=new`）                                                                                 |
| `cache.ts`      | `/api/v1/cache`             | 缓存管理（admin）：统计、清理过期、按 catalog 失效、列出/预览/删除/下载缓存条目                                                       |
| `log.ts`        | `/api/v1/log/frontend`      | 前端错误上报                                                                                                                          |

## 服务层 (server/services/) — 15 个

| 文件                  | 用途                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `yjs-doc.ts`          | 内存 DocState 缓存，`getOrCreateDoc()` 懒加载并持久化 Y.js update 到 SQLite                                       |
| `manual-assembler.ts` | `assembleManual()` 按 catalog 中 feature 列表读取 Y.js 文档组装 Markdown                                          |
| `site-builder/`       | 静态站点生成：`buildStaticSite()` → `data/docs/`，模板/样式/脚本分离，版本切换器 + `/latest/` 跳转                |
| `export-service.ts`   | 项目导出：收集数据 + 扫描上传引用 → `archiver` 流式 ZIP → `data/exports/`。`estimateExport()` / `runExportTask()` |
| `import-service.ts`   | 项目导入：`unzipper` 解析 ZIP → `analyzeImport()` 差异分析 → `applyImport()` 事务写入 + SHA-256 去重复制          |
| `upload-cleaner.ts`   | 孤儿文件扫描：扫描 document BLOB 提取 `/uploads/` 引用 → 与磁盘文件差集 → `deleteOrphanFiles()` 清理              |
| `markdown-export.ts`  | Markdown 文件导出服务                                                                                             |
| `notifications.ts`    | 飞书机器人消息通知（审核、指派等事件推送）                                                                        |
| `feishu.ts`           | 飞书 API 客户端（用户信息查询、消息发送、token 管理）                                                             |
| `ai-assistant.ts`     | AI 辅助写作：polish / summarize / fix / expand / custom，OpenAI 兼容接口                                          |
| `search.ts`           | 全文搜索：SQLite FTS5 索引，`searchDocs()` + `rebuildProjectIndex()`                                              |
| `audit.ts`            | 审计日志服务：`writeAuditLog()` 记录操作 + `queryAuditLogs()` 分页查询                                            |
| `pdf-export.ts`       | PDF 导出：通过 Puppeteer 将 Markdown 渲染为 PDF（支持自定义字体）                                                 |
| `export-cache.ts`     | 导出文件缓存管理（TTL 30 天，自动过期清理）                                                                       |
| `remote-cache.ts`     | 远程资源缓存（图片下载缓存，TTL 7 天，`data/cache/remote/`）                                                      |

## 认证模块 (server/auth/) — 5 个

| 文件            | 用途                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `middleware.ts` | `authMiddleware` 校验 JWT（含 `token_version` 比对），`requireRole(...roles)` 角色守卫 |
| `jwt.ts`        | `signToken()` / `verifyToken()`，含 `tokenVersion` 载荷                                |
| `token.ts`      | `extractToken()` — 从 Bearer header 或 Cookie 中统一提取 JWT                           |
| `feishu.ts`     | 飞书 OAuth 流程（授权 URL 生成、code 换 token、用户信息获取）                          |
| `membership.ts` | `isProjectMember()` — 项目成员检查（admin 全局通过）                                   |

## 工具库 (server/lib/) — 6 个

| 文件          | 用途                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `response.ts` | 统一 API 响应格式：`success()` / `created()` / `ok()` / `fail()`                                     |
| `logger.ts`   | Pino 结构化日志（双路输出：stdout + 文件轮转），`getLogger()` / `createChildLogger()`                |
| `password.ts` | 密码强度校验（3/4 规则：大写、小写、数字、特殊字符至少 3 种，8-128 位）                              |
| `crypto.ts`   | `generateState()` — 安全随机字符串（OAuth state 参数）                                               |
| `csrf.ts`     | CSRF 保护（double-submit cookie 模式）：`csrfMiddleware` + `generateCsrfToken()` + `setCsrfCookie()` |
| `swagger.ts`  | `registerSwagger()` — OpenAPI 3.x 文档 + Swagger UI (`/docs/api`)，含公共 Schema 定义                |

## 配置 (server/config.ts)

集中配置模块，统一读取环境变量并提供类型安全的默认值。涵盖：端口、数据库路径、JWT 密钥（生产强制设置）、上传/导出/导入目录、大小限制、飞书凭证、AI API（OpenAI 兼容）、PDF 字体、缓存 TTL、日志级别等。

## 数据库 (server/db/)

- `index.ts` — `initDatabase()` 幂等迁移（`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`），`getDb()` 获取 better-sqlite3 实例
- `schema.ts` — Drizzle ORM schema（12 表）

### 种子数据系统 (server/db/seed-manual/)

首次启动自动导入一份完整的操作手册内容（26 个功能、88 篇文档、7 个分类、1 个目录），让新实例立即可用。详见 [docs/seed.md](seed.md)。

## 测试 (server/\_\_tests\_\_/)

10 个测试文件：`auth.integration.test.ts`, `catalogs.test.ts`, `features.test.ts`, `jwt.test.ts`, `password.test.ts`, `permissions.test.ts`, `response.test.ts`, `upload.test.ts`, `yjs.test.ts`，以及 `test-app.ts` 测试应用工厂。
