# Server 启动流程

`server/index.ts` 是整个后端的入口文件。本文档按执行顺序说明初始化过程中每一步的作用。

## 启动时序

```
1. 环境变量加载 (dotenv/config)
2. Fastify 实例创建
3. 插件注册 (cors → helmet → rate-limit → websocket → multipart)
4. CSRF 中间件
5. 请求级用户上下文注入
6. 数据库初始化 + 种子数据
7. 缓存清理
8. 搜索索引重建
9. 静态文件服务
10. Swagger 文档
11. 路由注册 (18 个模块)
12. 文档站点访问控制
13. 全局错误处理 + 请求日志
14. 启动监听
```

## 1. Fastify 实例创建

```ts
Fastify({
  loggerInstance: getLogger(),   // Pino 结构化日志
  genReqId: () => randomUUID(),  // 每个请求生成 UUID
  bodyLimit: 500 * 1024 * 1024,  // 500MB（支持大文件上传）
})
```

## 2. 插件注册

| 顺序 | 插件 | 配置 |
|---|---|---|
| 1 | `@fastify/cors` | 白名单：`localhost:5173`、`localhost:{PORT}`、`CORS_ORIGIN` 环境变量；无 origin 的请求（curl/同源）放行 |
| 2 | `@fastify/helmet` | 安全响应头（`contentSecurityPolicy: false`） |
| 3 | `@fastify/rate-limit` | 全局 200 次/分钟（auth 路由内部可覆盖为更严格限制） |
| 4 | `@fastify/websocket` | WebSocket 支持（Y.js 协同编辑） |
| 5 | `@fastify/multipart` | 文件上传解析，限制为 `max(uploadMaxSize, videoMaxSize)` MB |

## 3. CSRF 保护

对所有非 GET/HEAD/OPTIONS 请求验证 `X-CSRF-Token` header 与 `csrf_token` cookie 一致。

**免检路径**：`/api/v1/auth/login`、`/api/v1/auth/feishu/*`、`/api/v1/auth/feishu-login`

详见 [server/lib/csrf.ts](../server/lib/csrf.ts)。

## 4. 请求级用户上下文

每个请求进入时自动尝试解析 JWT token（从 Bearer header 或 Cookie），验证通过后将 `_userId` 和 `_userRole` 注入到 request 对象，供后续中间件和路由使用。token 无效时静默跳过（用户视为未登录）。

## 5. 数据库初始化 + 种子

1. `initDatabase()` — 幂等建表 + 默认项目 + 管理员账号
2. `seedManualIfNeeded()` — 版本检测后导入种子手册数据

## 6. 启动时清理

- `cleanExpiredRemoteCache()` — 清理过期远程资源缓存（TTL 7 天）
- `cleanExpiredExportCache()` — 清理过期导出文件缓存（TTL 30 天）
- `rebuildProjectIndex()` — 遍历所有项目，重建 SQLite FTS5 全文搜索索引

## 7. 静态文件服务

| 路径前缀 | 目录 | 用途 |
|---|---|---|
| `/` | `dist/` | 生产环境前端构建产物（仅 `NODE_ENV=production`） |
| `/uploads/` | `data/uploads/` | 用户上传的图片和视频 |
| `/docs/` | `data/docs/` | 静态文档站点（发布后生成） |

**SPA fallback**（仅生产环境）：非 `/api/v1/` 和非 `/ws/` 路径返回 `index.html`。

## 8. Swagger 文档

- 自动 tag 分配：根据 URL 前缀（`/api/v1/projects` → `projects` 等）自动设置 Swagger tag
- Swagger UI：挂载在 `/docs/api`，需登录认证

## 9. 路由注册

18 个路由模块按顺序注册：

```
projectRoutes → categoryRoutes → yjsRoutes → authRoutes →
profileRoutes → userRoutes → feishuBindRoutes → featureRoutes →
catalogRoutes → dataTaskRoutes → uploadRoutes → todoRoutes →
cacheRoutes → auditRoutes → searchRoutes → aiRoutes →
diffRoutes → logRoutes
```

## 10. 文档站点访问控制

`/docs/{catalogId}/v{major}.{minor}/` 路径的访问控制 hook：

| visibility | 访问条件 |
|---|---|
| `public` | 任何人可访问（无需登录） |
| `login_required` | 需登录，未登录重定向到 `/login?redirect=...` |
| `project_members` | 需是该 catalog 所属项目的成员 |

辅助端点：
- `GET /docs/:catalogId/versions.json` — 按用户权限返回可见版本列表
- `GET /docs/:catalogId/latest` — 302 跳转到最新可见版本

## 11. 全局错误处理

- `statusCode >= 500` → 统一返回 `{ ok: false, error: '服务器内部错误' }`（隐藏内部错误细节）
- `statusCode < 500` → 返回具体错误消息
- 所有错误记录到结构化日志

## 12. 请求完成日志

每个请求结束后自动输出结构化日志：

```json
{
  "method": "GET",
  "url": "/api/v1/features?projectId=default",
  "statusCode": 200,
  "userId": "admin-user-1",
  "responseTime": 12.5
}
```
