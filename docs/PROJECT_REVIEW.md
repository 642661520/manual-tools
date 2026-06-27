# 项目审查报告 — 操作手册编写平台

> 审查日期：2026-06-27 | 分支：main

---

## 一、项目概览

| 维度 | 当前状态 |
|------|----------|
| 技术栈 | Vue 3.5 + Fastify 5 + SQLite + Y.js + TipTap 3.27 |
| 路由 | 18 个模块 |
| 服务 | 18 个模块 |
| 组件 | 27 个 |
| 测试 | 13 文件 / 64 用例 |
| TypeScript | 严格模式，禁止 `any` |
| 图标 | UnoCSS + Lucide |
| AI | OpenAI 兼容接口 |
| 部署 | 单进程，SQLite 持久化 |
| 日志 | Pino 结构化日志 |

---

## 二、已完成改进（对比初次审查）

| 维度 | 初次审查 | 现在 |
|------|---------|------|
| 测试文件 | 4 个 / 20 用例 | **13 个 / 64 用例** |
| 安全 | ❌ 弱JWT/OAuth/CSRF/上传 | ✅ JWT随机生成、OAuth crypto、CSRF双重验证、MagicBytes校验 |
| AI | 无 | ✅ BubbleMenu内联 + 4种预设 + 自定义指令 |
| 全文搜索 | 无 | ✅ LIKE搜索 + 高亮摘录 + 跳转定位 |
| 审计日志 | 无 | ✅ 操作记录 + 管理页面 |
| 版本对比 | 无 | ✅ 逐行Diff + 统计 |
| 发布审核 | ❌ 无校验 | ✅ 强制审核 + 可见性过滤 + 预览过滤 |
| 代码重复 | 10+ 处 | ✅ Token提取/Catalog检查/工具函数统一 |
| 日志 | console.log | ✅ Pino 结构化 + 文件日志 |
| 性能 | N+1/Yjs全量/Blob泄漏/固定轮询 | ✅ 事务包裹/rAF防抖/LRU缓存/指数退避 |

### 新增模块清单

**路由**（6 个）: `ai.ts`, `search.ts`, `audit.ts`, `diff.ts`, `log.ts`

**服务**（3 个）: `ai-assistant.ts`, `audit.ts`, `search.ts`

**组件**（6 个）: `SearchBox.vue`, `VersionDiff.vue`, `AiBubbleMenu.vue`, `AiPopover.vue`, `MediaUploadDialog.vue`, `Paginator.vue`, `SettingsSidebar.vue`, `PasswordInput.vue`, `UserAvatar.vue`

**工具**（3 个）: `auth/token.ts`, `lib/crypto.ts`, `lib/csrf.ts`

**测试**（5 个）: `catalogs.test.ts`, `features.test.ts`, `upload.test.ts`, `yjs.test.ts`, `permissions.test.ts`

---

## 三、待处理事项

### 高优先级

| 问题 | 说明 |
|------|------|
| 30+ 文件未提交 | 大量 `??` 文件（路由/服务/组件/测试），工作区需清理 |
| `pnpm-workspace.yaml` 冗余 | 仅 `shared/` 目录，无独立 `package.json`，可删除 |

### 中优先级

| 问题 | 说明 |
|------|------|
| 前端日志路由 | `logRoutes` 已注册但前端无对应调用 |
| Settings 视图未注册 | `DataManagement.vue` 和 `AuditLog.vue` 无路由入口 |

### 低优先级

| 问题 | 说明 |
|------|------|
| `.env.example` 未同步 | 新增 AI 配置项未反映到模板 |
| 无 CI/CD | `.github/workflows/` 目录为空 |

---

## 四、建议改进

| 建议 | 工作量 | 价值 |
|------|--------|------|
| AI 对话历史 | 小 | 保留最近 5 轮对话，支持回溯 |
| Dark Mode | 小 | UnoCSS `dark:` 切换 |
| 搜索优化 | 中 | 大数据量下 LIKE→FTS5 尝试验证 |
| CSRF 跳过 OPTIONS | 小 | 减少预检请求开销 |

---

## 五、扩展方向

| 方向 | 说明 | 工作量 |
|------|------|--------|
| 批量操作 | 多选 feature 删除/导出/移动项目 | 中 |
| 文档模板 | 预设 feature 骨架，一键创建标准文档 | 小 |
| 评论/批注 | 对 section 加行内评论，支持讨论 | 中 |
| OpenAPI 文档 | 自动生成 API 文档页面 | 小 |
| 统计仪表盘 | 文档数量/编辑活跃度/审核吞吐量 | 中 |
| i18n 国际化 | 前端多语言支持 | 大 |
| 实时通知 | WebSocket 推送审核状态变更 | 中 |
| SSO/OIDC | 企业 SSO 支持（除飞书外） | 大 |
| 离线 PWA | Service Worker + 离线编辑 + 同步 | 中 |

---

## 六、架构评价

**优势**：
- 清晰的分层架构（路由→服务→数据库）
- 多项目隔离设计完整
- Y.js CRDT 协同编辑架构先进
- 完整的导入导出管道（ZIP流式+进度轮询）
- 静态站点生成 + 版本管理 + 权限控制
- 安全防护全面（JWT/CSRF/MagicBytes/Cookie加固）
- 测试覆盖良好（13文件/64用例）
- 日志基础设施完善（Pino结构化）

**可改进**：
- 单进程部署，无横向扩展能力
- SQLite 不适合高并发场景（当前规模足够）
- 前端无状态管理，依赖模块单例（适合单体app）
- 缺乏 API 文档

---

## 七、文件变更清单（git status）

### 已修改 (M)

| 文件 | 说明 |
|------|------|
| `server/config.ts` | 新增 AI/日志配置 |
| `server/db/index.ts` | 新增 audit_log/search_docs 表、publish_scope 迁移 |
| `server/index.ts` | 新增路由注册、CSRF 中间件、搜索索引重建 |
| `server/routes/auth.ts` | Cookie 安全加固、CSRF 集成 |
| `server/routes/catalogs.ts` | 发布审核校验、审计日志、publish_scope |
| `server/routes/features.ts` | N+1 优化 |
| `server/auth/middleware.ts` | 统一 Token 提取 |
| `server/auth/membership.ts` | 新增 assertCatalogMember |
| `shared/types/api.ts` | 新增 PublishResponse 字段 |
| `shared/types/models.ts` | 新增 publishScope |
| `server/services/` | 多个服务更新 |
| `src/` | 多个组件/视图更新 |

### 新文件 (??)

| 类别 | 文件 |
|------|------|
| 路由 | `server/routes/ai.ts`, `search.ts`, `audit.ts`, `diff.ts`, `log.ts` |
| 服务 | `server/services/ai-assistant.ts`, `audit.ts`, `search.ts` |
| 工具 | `server/auth/token.ts`, `server/lib/crypto.ts`, `server/lib/csrf.ts` |
| 组件 | `SearchBox.vue`, `VersionDiff.vue`, `AiBubbleMenu.vue`, `AiPopover.vue`, `MediaUploadDialog.vue` |
| API | `src/api/endpoints/ai.ts`, `audit.ts`, `cache.ts`, `diff.ts`, `search.ts` |
| 共享 | `shared/utils/sections.ts`, `src/utils/storage.ts`, `src/utils/markdown.ts` |
| 测试 | 5 个后端 + 3 个前端测试文件 |
| CI | `.github/workflows/ci.yml` |

---

## 八、建议操作

```bash
# 1. 提交所有待提交文件
git add -A
git commit -m "feat: AI写作/全文搜索/审计日志/版本对比/安全加固/测试覆盖"

# 2. 同步 .env.example
# 3. 配置 CI/CD（.github/workflows/ci.yml 已就绪）

# 4. 考虑接下来的扩展方向：
#    - 小 (<1天): 文档模板 / OpenAPI 文档
#    - 中 (2-3天): 批量操作 / 统计仪表盘 / 评论批注
#    - 大 (1周+): i18n / SSO / PWA
```
