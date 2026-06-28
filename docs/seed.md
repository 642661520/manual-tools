# 种子数据系统

种子数据系统为 Manual Tools 平台自身提供一份完整的操作手册内容，让新部署的实例立即可用。

## 脚本命令

```bash
pnpm seed          # 强制重新导入种子数据（跳过版本检查，覆盖已有内容）
pnpm seed:export   # 将数据库中的文档内容回写到种子 .html 文件（开发阶段使用）
pnpm seed:sync     # seed:export + seed 串联执行（回写后立即重新导入验证）
```

## 架构概览

```
server/db/seed-manual/
├── content.ts         # 种子数据定义（分类、功能、目录结构、SEED_VERSION）
├── builder.ts         # ZIP 构建器（HTML → Y.js 快照 → 导出格式 ZIP）
├── index.ts           # 编排逻辑（版本检测 → 差异分析 → 导入）
├── force-seed.ts      # CLI 入口（pnpm seed）
├── sync-export.ts     # CLI 入口（pnpm seed:export）
├── images/            # 预置图片（通过 @seed/filename 引用）
└── documents/         # 92 个 HTML 种子文档
    ├── project-overview/    (2 篇)
    ├── project-crud/        (4 篇)
    ├── project-members/     (3 篇)
    ├── categories/          (4 篇)
    ├── features/            (4 篇)
    ├── editor/              (5 篇)
    ├── collaborative-editing/(3 篇)
    ├── ai-writing/          (4 篇)
    ├── media-upload/        (4 篇)
    ├── status-workflow/     (4 篇)
    ├── review-chain/        (4 篇)
    ├── todos/               (3 篇)
    ├── catalog-building/    (4 篇)
    ├── manual-preview/      (3 篇)
    ├── version-publishing/  (4 篇)
    ├── static-site/         (3 篇)
    ├── pdf-export/          (4 篇)
    ├── markdown-export/     (2 篇)
    ├── version-diff/        (2 篇)
    ├── user-management/     (4 篇)
    ├── permissions/         (3 篇)
    ├── profile/             (4 篇)
    ├── feishu-integration/  (3 篇)
    ├── data-import-export/  (4 篇)
    ├── search/              (2 篇)
    ├── audit-log/           (2 篇)
    └── ...共 94 个 .html 文件
```

## 种子内容

### 分类（7 个）

| ID | 名称 | 颜色 | 排序 |
|---|---|---|---|
| `cat-management` | 项目管理 | `#4f46e5` | 1 |
| `cat-features` | 功能与分类 | `#0891b2` | 2 |
| `cat-editing` | 文档编辑 | `#059669` | 3 |
| `cat-workflow` | 状态与审核 | `#d97706` | 4 |
| `cat-publishing` | 目录与发布 | `#dc2626` | 5 |
| `cat-users` | 用户与权限 | `#7c3aed` | 6 |
| `cat-system` | 系统与集成 | `#64748b` | 7 |

### 功能（27 个）+ 目录（1 个，含 7 个 Part）

目录 `manual-tools-manual` 将 22 个功能按 7 个 Part 组织为完整手册：

| Part | 包含功能 |
|---|---|
| 项目管理 | 项目管理概述、项目创建与管理、项目成员管理 |
| 功能与分类 | 分类管理、功能管理 |
| 文档编辑 | 富文本编辑器、实时协同编辑、AI 辅助写作、媒体上传 |
| 状态与审核 | 文档状态流转、审核链、待办管理 |
| 目录与发布 | 目录编排、手册预览、版本发布、静态站点、PDF 导出、Markdown 导出、版本对比 |
| 用户与权限 | 用户管理、权限体系、个人资料 |
| 系统与集成 | 飞书集成、数据导入导出、全文搜索、审计日志 |

## 工作流

### 初次启动自动导入

`server/index.ts` 启动时调用 `seedManualIfNeeded()`：

1. 检查 `seed_metadata` 表中的 `manual_data_version`
2. 如果版本为 0（全新安装），调用 `buildSeedZip()` → `applyImport()` 导入全部种子数据
3. 写入 `SEED_VERSION` 到 `seed_metadata`，下次启动跳过

### 种子版本更新

修改 `content.ts` 中的 `SEED_VERSION` 递增后，系统自动检测版本变化：

1. 构建新的种子 ZIP
2. `analyzeImport()` 分析新旧数据差异
3. `applyImport()` 以 `overwrite` 策略更新所有冲突项
4. 更新 `seed_metadata` 记录新版本

### 文档开发工作流

网页编辑 → `pnpm seed:export` 回写 → 提交 HTML 文件：

1. 在平台的富文本编辑器中编写和修改文档
2. 运行 `pnpm seed:export`：
   - 从 `document_snapshots` + `document_updates` 读取 Y.js 内容
   - 解码 Y.js doc → 提取 HTML 文本
   - 处理图片引用：`/uploads/images/ab/hash.png` → `@seed/uploaded-{hash}.png`
   - 复制图片到 `images/` 目录
   - 写回 `.html` 文件到 `documents/{feature}/{section}.html`
3. `git commit` 提交更新的 HTML 文件和图片
4. 可选：运行 `pnpm seed:sync` 验证回写内容可正确导入

### 图片处理

文档 HTML 使用两种图片引用方式：

- **`@seed/filename.png`** — 引用预置在 `images/` 目录的图片。构建 ZIP 时计算 SHA-256，替换为 `/uploads/images/{hash}/{hash}.ext` 并打包
- **`/uploads/images/...`** — 已哈希的上传文件引用（如在编辑器上传后运行 `seed:export` 回写的）。构建 ZIP 时从 `data/uploads/` 读取文件并打包

## 数据格式

种子 ZIP 与项目导出的格式完全一致（可被 `import-service` 直接解析）：

```
种子 ZIP 结构:
├── manifest.json     # { version, exportedAt, source }
├── data.json         # { data: { project, categories, features, documents, catalogs }, uploadsManifest }
└── uploads/          # 图片文件
    └── images/ab/hash.png
```

`data.json` 中每个 document 包含：
- `row` — 文档元数据（id, feature_id, section_key, status: 'approved', assignees 等）
- `snapshot` — base64 编码的 Y.js 状态向量（从 HTML 创建）
- `updates` — 增量更新列表（种子数据为空 `[]`）
