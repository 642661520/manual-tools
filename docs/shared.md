# 共享类型与工具 (shared/)

前后端共享的类型定义和工具函数，确保前后端使用一致的接口契约。

## 目录结构

```
shared/
├── types/
│   ├── index.ts          # 统一导出
│   ├── models.ts         # 领域模型类型
│   ├── api.ts            # API 响应类型
│   └── requests.ts       # API 请求体类型
└── utils/
    └── sections.ts       # Section JSON 解析工具
```

## types/models.ts — 领域模型

前后端共用的核心数据类型，字段名统一使用 camelCase。

### 用户相关

```ts
UserInfo        // { id, username, displayName, role, avatarUrl?, feishuName?, ... }
UserDetail      // UserInfo + { notifyEnabled, notifyPrefs, ... }
UserRow         // 数据库原始行（snake_case，仅后端用）
```

### 项目相关

```ts
ProjectInfo     // { id, name, description, reviewChain?, defaultProjectReadonly? }
ProjectRow      // 数据库原始行
```

### 功能相关

```ts
FeatureRow      // { id, title, description, sections (JSON string), is_custom, category_id, project_id, ... }
FeatureData     // FeatureRow + { sections (parsed SectionDef[]), categoryName?, categoryColor? }
```

### 目录相关

```ts
CatalogEntry    // 目录条目：{ type: 'feature'|'part', featureId?, title?, features?[] }
CatalogRow      // { id, title, targets (JSON), features (JSON), cover_info (JSON), project_id, ... }
CatalogData     // CatalogRow + { targets (parsed), features (parsed), coverInfo (parsed) }
```

### 文档相关

```ts
DocumentRow     // { id, feature_id, section_key, status, assignees (JSON), review_note, review_step, status_log (JSON) }
DocumentStatus  // 'draft' | 'in_progress' | 'completed' | 'pending_review' | 'approved' | 'rejected'
```

### 版本相关

```ts
CatalogVersion  // { catalog_id, version_major, version_minor, title, change_notes, visibility, features_snapshot, ... }
```

### 导入导出相关

```ts
ExportEstimate  // { features, documents, catalogs, versions, categories, members, uploads, totalBytes }
ImportDiffReport   // { categories, features, catalogs (各有 new/conflicted/unchanged 列表) }
ImportApplyResult  // { categories, features, catalogs, documents 的写入计数 }
ImportApplyOptions // { strategies: { categories, features, catalogs, documents } }
DataTaskInfo    // 异步任务状态
```

### 上传相关

```ts
OrphanFile      // { path, filename, size, modified }
UploadFileInfo  // { path, filename, size, modified, referenced, orphaned }
```

### 通知相关

```ts
NotificationPrefs   // 用户通知偏好
AuditLogEntry       // { userId, action, targetType, targetId, detail }
AuditLogRow         // 数据库审计日志行 + { username, displayName }
```

### 工具类型

```ts
SectionDef      // { key, title, description? } — 功能章节定义
CatalogPart     // { type: 'part', id, title, features[] } — 目录分区
isCatalogPart(entry)  // 类型守卫
```

## types/api.ts — API 响应类型

所有 API 端点的响应形状类型定义。

| 类型 | 对应端点 |
|---|---|
| `ApiWrapped<T>` | 通用响应 wrapper：`{ ok: true, data: T }` 或 `{ ok: false, error: string }` |
| `ApiRequestError` | 前端错误类（status + body） |
| `LoginResponse` | `POST /api/auth/login` |
| `MeResponse` | `GET /api/auth/me` |
| `ProfileUpdateResponse` | `PUT /api/auth/me` |
| `UsernameChangeResponse` | `PUT /api/auth/me/username` |
| `PasswordChangeResponse` | `PUT /api/auth/me/password` |
| `FeishuBindingResponse` | `PUT /api/auth/me/feishu-binding` |
| `PublishResponse` | `POST /api/catalogs/:id/publish` |
| `UploadImageResponse` | `POST /api/upload/image` |
| `CreateResponse` | `POST` 创建资源通用响应 `{ id: string }` |
| `ManualPreviewResponse` | `GET /api/catalogs/:id/preview` |
| `ChapterResponse` | `GET /api/catalogs/:id/chapters/:chNum` |
| `VersionPreviewResponse` | `GET /api/catalogs/:id/versions/:versionId/preview` |
| `OAuthUrlResponse` | 飞书 OAuth URL |
| `ExportEstimateResponse` | 导出大小预估 |
| `ImportAnalyzeResponse` | 导入差异分析 |
| `ImportApplyResponse` | 导入应用结果 |
| `OrphansResponse` / `UploadsResponse` | 上传文件状态 |

## types/requests.ts — API 请求体类型

所有 POST/PUT 端点的请求体类型定义。

| 类型 | 对应端点 |
|---|---|
| `LoginBody` | 登录 |
| `UpdateProfileBody` | 更新资料 |
| `ChangeUsernameBody` | 修改用户名 |
| `ChangePasswordBody` | 修改密码 |
| `CreateUserBody` | 创建用户 |
| `CreateProjectBody` / `UpdateProjectBody` | 项目创建/更新 |
| `AddMemberBody` | 添加项目成员 |
| `CreateFeatureBody` / `UpdateFeatureBody` | 功能创建/更新 |
| `UpdateSectionStatusBody` | 更新文档状态 |
| `UpdateSectionsBody` | 更新功能章节定义 |
| `CreateCatalogBody` / `UpdateCatalogBody` | 目录创建/更新 |
| `PublishBody` | 发布版本 |
| `CreateCategoryBody` | 创建分类 |
| `ImportApplyReqBody` | 导入应用请求 |

## utils/sections.ts — Section 工具

```ts
SectionDef       // { key: string, title: string, description?: string }
parseSections(sections: string | SectionDef[]): SectionDef[]
```

将数据库中的 sections JSON 字符串或已解析的数组统一转换为 `SectionDef[]`，后端 `server/types.ts` 和前端均可使用。

## 使用方式

### 前端导入

```ts
// tsconfig 已配置 @shared → shared/
import type { UserInfo, CatalogEntry, SectionDef } from '@shared/types'
import { isCatalogPart, parseSections } from '@shared/types'
```

### 后端导入

```ts
// tsconfig.node.json 已配置 @shared → shared/
import type { UserInfo, CatalogEntry } from '@shared/types'
```

### 字段名约定

shared 类型统一使用 **camelCase**（前端友好）。后端通过 `src/api/transform.ts` 的 `camelCaseToSnakeCase` / `snakeCaseToCamelCase` 做双向转换，因此数据库读写时使用 snake_case，API 层和前端使用 camelCase。
