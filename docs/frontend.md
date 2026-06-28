# 前端架构

## 路由 (src/router.ts) — 13 条

| 路径                    | 名称             | 视图                                 | 权限  |
| ----------------------- | ---------------- | ------------------------------------ | ----- |
| `/login`                | login            | `views/login/index.vue`              | 公开  |
| `/`                     | —                | 重定向到 `/features`                 | —     |
| `/features`             | feature-list     | `views/feature-list/index.vue`       | 登录  |
| `/features/:id/edit`    | feature-editor   | `views/feature-editor/index.vue`     | 登录  |
| `/catalogs/:id`         | catalog-builder  | `views/catalog-builder/index.vue`    | 登录  |
| `/preview`              | preview-index    | `views/manual-preview/index.vue`     | 登录  |
| `/preview/:id`          | manual-preview   | `views/manual-preview/index.vue`     | 登录  |
| `/catalogs/:id/preview` | —                | 重定向到 `/preview/:id`              | —     |
| `/settings`             | settings         | `views/settings/index.vue`           | admin |
| `/settings/project`     | project-settings | `views/settings/ProjectSettings.vue` | 登录  |
| `/profile`              | profile          | `views/profile/index.vue`            | 登录  |
| `/todos`                | todo-list        | `views/todo-list/index.vue`          | 登录  |
| `/feishu-callback`      | feishu-callback  | `views/feishu-callback/index.vue`    | 公开  |

## API 端点 (src/api/) — 17 个文件

- `client.ts` — 统一 fetch 封装，自动注入 JWT token，统一错误处理
- `transform.ts` — camelCase/snake_case 双向转换
- `index.ts` — 统一导出

`endpoints/` 目录 (14 个模块):

| 文件            | 对应后端路由     |
| --------------- | ---------------- |
| `auth.ts`       | 登录/注册/飞书   |
| `projects.ts`   | 项目 CRUD        |
| `categories.ts` | 分类 CRUD        |
| `features.ts`   | 功能 CRUD + 导入 |
| `catalogs.ts`   | 目录 CRUD        |
| `documents.ts`  | 文档操作         |
| `todos.ts`      | 待办查询         |
| `upload.ts`     | 文件上传         |
| `data-tasks.ts` | 数据导入导出     |
| `ai.ts`         | AI 辅助写作      |
| `audit.ts`      | 审计日志         |
| `cache.ts`      | 缓存管理         |
| `diff.ts`       | 版本对比         |
| `search.ts`     | 全文搜索         |

## 共享组件 (src/components/) — 23 个 + 4 编辑器子组件

### 基础组件

| 组件              | 用途                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `AppLayout`       | 全局布局：顶部导航 + 项目选择器 + 用户菜单                                         |
| `ModalDialog`     | 通用对话框，props: `visible/title/confirmText/cancelText/error/loading/widthClass` |
| `DialogContainer` | Teleported 对话框挂载点                                                            |
| `FormField`       | 表单字段 label+slot，props: `label/required`                                       |
| `ErrorMessage`    | 红色错误提示框，prop: `message`                                                    |
| `LoadingState`    | 居中加载状态，prop: `message`                                                      |
| `EmptyState`      | 空态占位，props: `icon/title/description`                                          |
| `PageHeader`      | 页面顶栏，slots: `#left` / `#right`                                                |
| `StatusBadge`     | 状态标记 `draft/in_progress/completed/approved/rejected`，variant: badge 或 text   |
| `UserAvatar`      | 用户头像（支持飞书头像 URL、首字母 fallback），size: `2xs/ xs/ sm/ md/ lg`         |

### 表单组件

| 组件             | 用途                                                        |
| ---------------- | ----------------------------------------------------------- |
| `SelectDropdown` | 可搜索下拉选择框                                            |
| `PasswordInput`  | 密码输入框（含显示/隐藏切换），v-model 绑定                 |
| `SearchBox`      | 全局搜索框，支持快捷键 `Ctrl+K` 唤起，调用 `/api/v1/search` |
| `ColorPicker`    | 颜色选择器（文字颜色 10 色 + 背景高亮 10 色）               |

### 编辑器组件

| 组件                    | 用途                                                     |
| ----------------------- | -------------------------------------------------------- |
| `TiptapEditor`          | 富文本编辑器：TipTap + Y.js 绑定 + 全工具栏 + 底部状态栏 |
| `StatusTransitionModal` | 状态流转弹窗（含审核意见、指派人员、审核链显示）         |
| `SearchReplaceBar`      | 查找替换栏（查找/替换/全部替换/区分大小写）              |
| `TableBubbleMenu`       | 表格浮动菜单（行列增删/表头切换）                        |
| `TableGridPicker`       | 表格尺寸选择器（行列数网格选取）                         |
| `CrossrefPicker`        | 交叉引用选择器（选择目标 feature/section）               |

### 导航/布局组件

| 组件              | 用途                                                         |
| ----------------- | ------------------------------------------------------------ |
| `SettingsSidebar` | 设置页侧边栏（项目设置/用户管理/审计日志/数据管理 tab 切换） |
| `Paginator`       | 分页器，props: `current/total`，emit: `go(page)`             |

### 数据展示组件

| 组件          | 用途                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| `VersionDiff` | 版本对比弹窗，展示两个发布版本的 Markdown 逐行差异（新增/删除/不变），含统计信息 |

### 编辑器子组件 (src/components/editor/)

| 组件                | 用途                                            |
| ------------------- | ----------------------------------------------- |
| `AiBubbleMenu`      | AI 写作浮动菜单（选中文本后显示）               |
| `AiPanel`           | AI 写作侧面板（润色/总结/修复/扩充/自定义指令） |
| `AiPopover`         | AI 操作结果弹出层                               |
| `MediaUploadDialog` | 媒体上传对话框（图片/视频，含大小限制提示）     |

## 组合式函数 (src/composables/) — 11 个

| Composable         | 用途                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `useAuth`          | 模块级 reactive refs，login/logout/token 管理                                              |
| `useProject`       | 模块级单例，localStorage 持久化 `active_project_id`，`switchProject()` / `loadProjects()`  |
| `useYjsDoc`        | 客户端 Y.js doc + WebSocket 连接，sync step 握手 + update 广播 + awareness 收发            |
| `useTiptapYjs`     | TipTap editor 绑定到 Y.js `ytext('content')`，本地编辑→Y.js 同步，远程更新→editor dispatch |
| `useDialog`        | 对话框堆栈管理（alert/confirm/prompt）                                                     |
| `useSidebarTree`   | 编辑器左侧导航树：从 catalog features 构建章节/分部分层级结构                              |
| `cursor-awareness` | TipTap Extension，渲染远程用户光标位置                                                     |
| `search-highlight` | 查找高亮 composable                                                                        |
| `markdown-paste`   | Markdown 粘贴处理（粘贴时自动转换 Markdown 为 TipTap 节点）                                |
| `crossref-node`    | 交叉引用 Node 定义（feature/section 内链）                                                 |
| `video-node`       | 视频 Node 定义（video 类型节点）                                                           |

## 页面视图 (src/views/) — 9 个

| 视图               | 文件                                                                     | 用途                                                                               |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `login/`           | `index.vue`                                                              | 用户名密码登录 + 飞书 OAuth 登录                                                   |
| `feature-list/`    | `index.vue`                                                              | PM 集中管理：创建/编辑/删除自定义功能、导入 JSON 骨架（diff 确认界面）、按分类分组 |
| `feature-editor/`  | `index.vue`                                                              | 运维编写：左侧功能导航树 + 右侧 TipTap 编辑器，支持状态流转和 AI 写作              |
| `catalog-builder/` | `index.vue`                                                              | PM 编排：左侧可选功能池（搜索+按分类分组）+ 右侧拖拽排序已选功能                   |
| `manual-preview/`  | `index.vue`, `PreviewContent.vue`, `PreviewSidebar.vue`                  | 手册预览 + 版本发布 + 版本对比                                                     |
| `settings/`        | `index.vue`, `AuditLog.vue`, `DataManagement.vue`, `ProjectSettings.vue` | PM 设置：项目管理 + 用户管理 + 审计日志 + 数据管理                                 |
| `profile/`         | `index.vue`                                                              | 个人资料查看 + 飞书账号绑定                                                        |
| `todo-list/`       | `index.vue`                                                              | 我的待办汇总（按状态分组）                                                         |
| `feishu-callback/` | `index.vue`                                                              | 飞书 OAuth 回调处理                                                                |

## 工具与指令

- `src/utils/markdown.ts` — Markdown 渲染（基于 markdown-it，支持 HTML、自动链接、排版美化）
- `src/utils/storage.ts` — localStorage 安全读写（用户信息持久化）
- `src/directives/tooltip.ts` — `v-tooltip` 指令，hover/focus 时显示提示文本，支持 top/bottom 位置

## 测试 (src/\_\_tests\_\_/)

5 个测试文件：`api/transform.test.ts`, `components/shared-components.test.ts`, `composables/useAuth.test.ts`, `utils/markdown.test.ts`, `utils/storage.test.ts`
