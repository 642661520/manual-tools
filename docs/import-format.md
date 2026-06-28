# 导入文件格式规范

Manual Tools 支持通过 ZIP 文件导入项目数据。本文档定义 ZIP 文件的目录结构和各文件格式，供其他项目和 AI 生成符合规范的导入文件。

## 目录结构

```
{任意名称}.zip
├── manifest.json                # 导出元信息
├── project.json                 # 项目基本信息
├── categories.json              # 分类列表
├── features/                    # 功能定义（每个功能一个 JSON 文件）
│   └── {feature-id}.json
├── documents/                   # 文档内容（HTML 格式，按功能分目录）
│   └── {feature-id}/
│       └── {section-key}.html
├── catalogs/                    # 目录编排（每个目录一个 JSON 文件）
│   └── {catalog-id}.json
└── uploads/                     # 附件资源（图片、视频）
    └── images/
        └── {shard}/             # hash 前2位作为子目录
            └── {hash}.{ext}     # SHA-256 哈希文件名
```

## 各文件格式

### manifest.json

```json
{
  "exportedAt": "2026-06-28T12:00:00.000Z",
  "source": {
    "projectId": "my-project",
    "projectName": "我的项目"
  }
}
```

| 字段                 | 类型   | 说明                                     |
| -------------------- | ------ | ---------------------------------------- |
| `exportedAt`         | string | ISO 8601 时间戳                          |
| `source.projectId`   | string | 来源项目 ID（导入时不会覆盖目标项目 ID） |
| `source.projectName` | string | 来源项目名称（仅用于差异预览显示）       |

### project.json

```json
{
  "id": "my-project",
  "name": "操作手册",
  "description": "产品操作手册编写平台"
}
```

| 字段          | 类型   | 说明                             |
| ------------- | ------ | -------------------------------- |
| `id`          | string | 项目唯一 ID，建议使用 kebab-case |
| `name`        | string | 项目名称                         |
| `description` | string | 项目描述                         |

### categories.json

```json
[
  {
    "id": "cat-overview",
    "name": "平台概述",
    "color": "#6366f1",
    "sort_order": 1
  },
  {
    "id": "cat-writing",
    "name": "文档编写",
    "color": "#059669",
    "sort_order": 2
  }
]
```

| 字段         | 类型   | 说明                           |
| ------------ | ------ | ------------------------------ |
| `id`         | string | 分类唯一 ID                    |
| `name`       | string | 分类名称                       |
| `color`      | string | 颜色（十六进制，如 `#6366f1`） |
| `sort_order` | number | 排序序号                       |

### features/{feature-id}.json

```json
{
  "id": "my-project:introduction",
  "title": "平台介绍",
  "description": "平台的基本功能介绍",
  "sections": [
    { "key": "overview", "title": "概览", "description": "平台整体概览" },
    { "key": "quickstart", "title": "快速开始", "description": "5 分钟上手" }
  ],
  "is_custom": 0,
  "category_id": "cat-overview"
}
```

| 字段                     | 类型           | 说明                                     |
| ------------------------ | -------------- | ---------------------------------------- |
| `id`                     | string         | 功能唯一 ID，建议格式 `{project}:{name}` |
| `title`                  | string         | 功能标题                                 |
| `description`            | string         | 功能描述                                 |
| `sections`               | array          | 章节定义数组                             |
| `sections[].key`         | string         | 章节键名，对应 HTML 文件名               |
| `sections[].title`       | string         | 章节标题                                 |
| `sections[].description` | string         | 章节描述（可选）                         |
| `is_custom`              | number         | 是否为自定义功能（0 或 1）               |
| `category_id`            | string \| null | 所属分类 ID                              |

### documents/{feature-id}/{section-key}.html

纯 HTML 文件，包含 Tiptap 富文本编辑器输出的内容。文件名与 feature 的 `sections[].key` 对应。

```html
<h1>平台概览</h1>
<p>Manual Tools 是一个操作手册编写平台。</p>
<h2>核心功能</h2>
<ul>
  <li><p>多项目隔离管理</p></li>
  <li><p>富文本协同编辑</p></li>
  <li><p>多版本发布</p></li>
</ul>
<p>详情请参考 <a href="/features/my-project:quickstart">快速开始</a></p>
```

**HTML 格式说明**：

- 内容由 Tiptap 编辑器生成，遵循 ProseMirror schema
- 支持的标签：`h1`-`h6`, `p`, `ul`/`ol`/`li`, `blockquote`, `pre`/`code`, `img`, `video`, `a`, `table`/`tr`/`td`/`th`, `strong`, `em`, `s`, `br`, `hr`
- 图片使用相对路径引用（见下方）
- 链接可使用绝对路径（以 `/` 开头）

**图片引用规范**：

图片必须使用相对路径，相对于文档所在位置：

```html
<!-- 文档位置: documents/my-project:introduction/overview.html -->
<!-- 图片位置: uploads/images/ab/fullhash.png -->
<img src="../../uploads/images/ab/8a7b3c9d...（64位hex）.png" alt="截图" />

<!-- 视频同理 -->
<video src="../../uploads/videos/cd/7f8e9a...（64位hex）.mp4"></video>
```

图片路径规则：

- 文档 → 图片的相对路径为 `../../uploads/images/{shard}/{hash}.{ext}`
- 导入时系统会自动为**非 hash 文件名**计算 SHA-256 并重命名
- 你可以直接使用原始文件名（如 `../../uploads/images/screenshot.png`），导入时会自动处理
- **建议**：手动创建时使用原始文件名，让系统自动 hash；程序化生成时预计算 hash 避免重复处理

### catalogs/{catalog-id}.json

```json
{
  "id": "my-catalog",
  "title": "用户手册 v1.0",
  "targets": ["新用户", "管理员"],
  "features": [
    { "featureId": "my-project:introduction" },
    {
      "type": "part",
      "id": "part-basics",
      "title": "基础操作",
      "features": [{ "featureId": "my-project:quickstart" }]
    }
  ],
  "cover_info": {
    "title": "用户手册",
    "subtitle": "操作指南",
    "version": "1.0.0"
  },
  "versions": []
}
```

| 字段                      | 类型     | 说明                           |
| ------------------------- | -------- | ------------------------------ |
| `id`                      | string   | 目录唯一 ID                    |
| `title`                   | string   | 目录标题                       |
| `targets`                 | string[] | 目标读者标签                   |
| `features`                | array    | 编排的功能列表                 |
| `features[].featureId`    | string   | 引用的 feature ID              |
| `features[].sectionOrder` | string[] | 章节排序（可选）               |
| `features[].type`         | string   | `"part"` 表示分组（可选）      |
| `cover_info`              | object   | 封面信息                       |
| `versions`                | array    | 发布版本列表（导入时通常为空） |

### uploads/ 目录

附件文件按 hash 分片存储：

```
uploads/
├── images/
│   ├── ab/
│   │   └── ab8a7b3c9d...（64位hex）.png
│   └── cd/
│       └── cd7f8e9a...（64位hex）.mp4
└── videos/
    └── ef/
        └── ef123abc...（64位hex）.mp4
```

**命名规则**：

- 文件名 = **SHA-256 哈希** + 原始扩展名（64 位 hex）
- 分片目录 = 哈希的前 2 位
- 导入时，非 hash 命名的文件会自动计算 SHA-256 并按此规则存放
- 如果已存在相同 hash 的文件（内容相同），自动跳过（去重）

## 完整示例：最小可导入 ZIP

创建一个包含 1 个功能 + 1 篇文档的最小 ZIP：

```
example.zip
├── manifest.json
├── project.json
├── categories.json
├── features/
│   └── example:hello.json
├── documents/
│   └── example:hello/
│       └── greeting.html
└── catalogs/
    └── example-catalog.json
```

**manifest.json**：

```json
{
  "exportedAt": "2026-06-28T12:00:00.000Z",
  "source": { "projectId": "example", "projectName": "示例项目" }
}
```

**project.json**：

```json
{
  "id": "example",
  "name": "示例项目",
  "description": "一个示例导入项目"
}
```

**categories.json**：

```json
[{ "id": "cat-basics", "name": "基础", "color": "#6366f1", "sort_order": 1 }]
```

**features/example:hello.json**：

```json
{
  "id": "example:hello",
  "title": "Hello World",
  "description": "第一个功能",
  "sections": [{ "key": "greeting", "title": "问候", "description": "打个招呼" }],
  "is_custom": 0,
  "category_id": "cat-basics"
}
```

**documents/example:hello/greeting.html**：

```html
<h1>Hello World</h1>
<p>欢迎使用 Manual Tools！</p>
```

**catalogs/example-catalog.json**：

```json
{
  "id": "example-catalog",
  "title": "示例目录",
  "targets": ["所有用户"],
  "features": [{ "featureId": "example:hello" }],
  "cover_info": {},
  "versions": []
}
```

## AI 生成指南

让 AI 生成导入 ZIP 时，遵循以下步骤：

### 1. 确定数据范围

- **必有**：`manifest.json`、`project.json`
- **按需**：`categories.json`（有分类时）、`features/`（有功能时）、`documents/`（有文档时）、`catalogs/`（有目录时）
- **按需**：`uploads/`（有附件时）

### 2. 生成 JSON 文件

- 所有 JSON 使用 **2 空格缩进**、UTF-8 编码
- ID 使用 **kebab-case** 或 `{namespace}:{name}` 格式
- 确保 feature 的 `sections[].key` 与 HTML 文件名一致

### 3. 生成 HTML 文档

- 使用标准 HTML 标签，不超过 Tiptap 支持的标签范围
- 无 `<html>`、`<head>`、`<body>` 包裹——直接写内容标签
- 图片使用 `../../uploads/images/原始文件名.png` 引用
- 链接使用绝对路径 `/features/{feature-id}` 或相对路径

### 4. 打包 ZIP

- 使用标准 ZIP 格式（deflate 压缩）
- 文件名使用 UTF-8 编码
- 保持与上述目录结构一致

### 5. 导入

在 Manual Tools 项目管理 → 导入导出 → 选择 ZIP 文件 → 预览差异 → 确认导入。
