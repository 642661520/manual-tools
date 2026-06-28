# 编码规范

## UnoCSS 设计系统

自定义 shortcuts（定义在 `uno.config.ts`）: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card`, `.input`, `.label`。全局使用这些 shortcuts 保持样式一致，不引入组件库。

## 图标规范

**禁止使用文字图标**（emoji、Unicode 符号、纯文本字符）。项目使用 UnoCSS `presetIcons` + `@iconify-json/lucide`。

**使用方式：**

```html
<span class="i-lucide-<icon-name> w-4 h-4 inline-block align-middle" />
```

- 图标通过 `i-lucide-*` CSS class 引用，UnoCSS 构建时内联为 SVG
- 标准尺寸 `w-4 h-4`，较大 `w-5 h-5`，辅以 `inline-block align-middle`
- `extraProperties` 已全局设置 `display: inline-block; flex-shrink: 0; transform: translateY(-1px)`

**可用图标：** 在 [Iconify Lucide](https://icon-sets.iconify.design/lucide/) 搜索，使用 `i-lucide-<name>` 格式。

**禁止项：**

- ❌ emoji 作为图标：`💡`, `⚠️`, `✅`, `❌` 等
- ❌ Unicode 符号作为图标：`×`, `✓`, `→`, `…` 等
- ❌ 纯文本字符作为图标：`Aa`, `B`, `I`, `S`, `U`, `x₂`, `x²`, `H1`-`H6` 等
- ✅ 使用对应的 Lucide 图标：`i-lucide-lightbulb`, `i-lucide-alert-triangle`, `i-lucide-bold`, `i-lucide-heading-1` 等

**例外：** 纯文本提示信息中（如 `<p>` 标签内的说明文字），可使用少量标点符号（如 `→`、`：`）辅助表达，但不得替代图标功能。

## 项目上下文传递

后端通过 query 参数 `?projectId=xxx` 过滤 features 和 catalogs。前端 `useProject()` composable 管理当前项目（localStorage 持久化），受影响的视图通过 `watch(currentProjectId, reloadData)` 自动刷新。Y.js 和站点生成管道按 feature/catalog ID 全局唯一操作。

## 表单校验模式

所有表单使用统一的 `errorRef` + `ErrorMessage` 组件模式。

核心原则：**按钮不做 `:disabled` 阻止点击**（会导致错误提示永远不显示），而是靠函数内校验显示错误信息。

三步校验流程：

1. 前端空值/格式检查
2. API 响应 `body.error` 检查
3. `catch` 网络异常

## TypeScript 规范

- **禁止 `any`** — ESLint 规则 `@typescript-eslint/no-explicit-any: error`
- **DB 查询类型断言** — 使用 `as FeatureRow`, `as CatalogRow` 等明确类型（来自 `server/types.ts`）
- **前端类型** — 优先使用 `shared/types/` 中的共享类型 `UserInfo`, `CatalogEntry` 等
- **Y.js `origin` 参数** — 使用 `unknown` 类型
- **catch 块** — 使用 `e: unknown` + `e instanceof Error` 类型守卫
- **WebSocket 类型** — 使用 `import type { WebSocket as WsSocket } from 'ws'` 避免与 Node 全局 WebSocket 冲突

## 路由与权限模式

- 前端路由 meta：`requiresAuth: true` 需要登录，`requiresAdmin: true` 需要 admin 角色
- 后端路由：`authMiddleware` 校验 JWT，`requireRole('admin')` 限制角色
- 项目级权限：`isProjectMember(userId, role, projectId)` — admin 全局通过，其他角色检查 `project_members` 表

## 文件命名约定

- 路由文件：`server/routes/<name>.ts`，导出 `async function <name>Routes(app)`
- 服务文件：`server/services/<name>.ts`
- 认证文件：`server/auth/<name>.ts`
- 工具库文件：`server/lib/<name>.ts`
- Vue 组件：PascalCase 单文件组件，编辑器子组件放 `editor/` 子目录
- Composables：`use<Name>.ts` 或 kebab-case 描述性名称
- API 端点：与后端路由同名 `src/api/endpoints/<name>.ts`

## API 约定

- RESTful 风格，路径前缀 `/api/v1/`
- 统一响应格式：成功 `{ ok: true, data: T }`，失败 `{ ok: false, error: string }`
- 前端通过 `client.ts` 自动注入 `Authorization: Bearer <token>` header
- CSRF 保护：登录后设置 `csrf_token` cookie，前端以 `X-CSRF-Token` header 回传，状态变更请求比对一致

### 字段名转换：snake_case ↔ camelCase（⚠️ 必须理解）

`src/api/transform.ts` 提供 `toCamelCase` / `toSnakeCase` 双向转换。**关键行为：**

- **所有 API 响应**在 `client.ts` 第 92 行自动执行 `toCamelCase()`，数据库的 snake_case 字段（`cover_info`、`created_at`、`latest_version_major` 等）到达前端时**已经是** camelCase（`coverInfo`、`createdAt`、`latestVersionMajor`）
- **所有 API 请求** body 自动执行 `toSnakeCase()`，前端 camelCase 字段发送到后端前转为 snake_case

**前端开发铁律：**

- ❌ **禁止**使用 snake_case 访问 API 响应对象的属性 — `obj.latest_version_major` 永远是 `undefined`
- ✅ 所有前端类型定义（`interface`、`type`）使用 camelCase
- ✅ 不需要 `obj.snake_case \|\| obj.camelCase` 这样的兜底写法
- ✅ 后端路由返回的字段名保持 snake_case（数据库字段名），转换由 `client.ts` 统一处理

## 日志规范

- 后端统一使用 `getLogger()` 获取 Pino 实例（`server/lib/logger.ts`）
- 结构化日志格式：`log.info({ userId, action }, '描述')`
- 请求级日志使用 `createChildLogger({ requestId, userId })` 创建子 logger
- 前端错误通过 `POST /api/v1/log/frontend` 上报
