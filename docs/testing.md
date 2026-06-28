# 测试体系

使用 [Vitest](https://vitest.dev/) 作为测试框架，支持前后端统一测试。

## 快速命令

```bash
pnpm test              # 运行所有测试（单次）
pnpm test:watch        # 监听模式（开发时使用）
pnpm test:coverage     # 生成覆盖率报告
```

## 测试结构

```
server/__tests__/                    # 后端测试（36 个文件）
├── test-app.ts                      # 测试应用工厂（构建 Fastify 实例）
├── auth.integration.test.ts         # 认证集成测试
├── auth-middleware.test.ts          # 认证中间件测试
├── middleware.test.ts               # 通用中间件测试
├── membership.test.ts               # 成员资格检查测试
├── token.test.ts                    # Token 提取测试
├── config.test.ts                   # 配置模块测试
├── catalogs.test.ts                 # 目录 CRUD 测试
├── features.test.ts                 # 功能 CRUD 测试
├── permissions.test.ts              # 权限中间件测试
├── jwt.test.ts                      # JWT 签发/验证单元测试
├── password.test.ts                 # 密码强度校验测试
├── response.test.ts                 # API 响应格式测试
├── crypto.test.ts                   # 加密工具测试
├── pagination.test.ts               # 分页工具测试
├── upload.test.ts                   # 上传功能测试
├── upload-refs.test.ts              # 上传引用提取测试
├── yjs.test.ts                      # Y.js 协同编辑测试
├── yjs-routes.test.ts               # Y.js WebSocket 路由测试
├── yjs-utils.test.ts                # Y.js 编解码工具测试
├── logger.test.ts                   # 日志工具测试
├── csrf.test.ts                     # CSRF 保护测试
├── search-service.test.ts           # 搜索服务测试
├── audit-service.test.ts            # 审计服务测试
├── manual-assembler.test.ts         # 手册组装器测试
├── export-cache.test.ts             # 导出缓存测试
├── site-builder-shared.test.ts      # 站点构建共享逻辑
├── site-builder-sidebar.test.ts     # 站点构建侧边栏
├── site-builder-search.test.ts      # 站点构建搜索
├── site-builder-content.test.ts     # 站点构建内容
├── e2e-business-flows.test.ts       # E2E 核心业务流程
├── e2e-profile-export.test.ts       # E2E 资料导出
├── e2e-export-import.test.ts        # E2E 导入导出
├── simple-routes.test.ts            # 基础路由冒烟测试
├── more-routes.test.ts              # 扩展路由测试
├── error-paths.test.ts              # 错误路径覆盖测试
└── feishu-card.test.ts              # 飞书卡片消息测试

src/__tests__/                       # 前端测试（7 个文件）
├── api/
│   └── transform.test.ts            # API 字段转换测试
├── components/
│   └── shared-components.test.ts    # 共享组件渲染测试
├── composables/
│   ├── useAuth.test.ts              # 认证逻辑测试
│   ├── useDialog.test.ts            # 对话框逻辑测试
│   └── toast.test.ts                # Toast 消息测试
└── utils/
    ├── markdown.test.ts             # Markdown 渲染测试
    └── storage.test.ts              # localStorage 工具测试
```

## 配置 (vite.config.ts)

```ts
test: {
  environment: 'node',               // 默认 Node 环境
  include: [                         // 测试文件匹配
    'src/__tests__/**/*.test.ts',
    'server/__tests__/**/*.test.ts',
  ],
  testTimeout: 10000,                // 10s 超时
  coverage: {
    provider: 'v8',
    thresholds: {                    // 覆盖率门槛
      statements: 50,
      branches: 40,
      functions: 40,
      lines: 50,
    },
  },
}
```

前端组件/composable 测试需在文件顶部标注 `/** @vitest-environment jsdom */` 以启用 DOM 环境。

## 后端测试模式

### 集成测试（使用 test-app.ts）

`test-app.ts` 提供 `buildTestApp()` 构建最小 Fastify 实例，使用 `app.inject()` 模拟 HTTP 请求，**不启动端口监听**：

```ts
import { buildTestApp, cleanupTestData } from './test-app.js'

const app = await buildTestApp()
const res = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { username: 'test', password: 'test123' },
})
expect(res.statusCode).toBe(200)
```

`cleanupTestData(db, prefix)` 按 FK 依赖顺序清理测试数据（子表 → 父表），使用 `LIKE '%__test_{prefix}%'` 匹配测试创建的记录。

### 单元测试

直接导入被测模块，不依赖 Fastify：

```ts
// jwt.test.ts
import { signToken, verifyToken } from '../auth/jwt.js'

it('应签发并校验有效 token', () => {
  const token = signToken(payload)
  const decoded = verifyToken(token)
  expect(decoded.userId).toBe('user-001')
})
```

## 测试约定

- 测试文件命名：`*.test.ts`
- 测试框架：Vitest（`describe` / `it` / `expect`）
- 集成测试使用 `app.inject()` 而非真实 HTTP 请求
- 测试数据使用 `__test_` 前缀便于清理
- JSDOM 仅用于需要 DOM 的前端测试
- 覆盖率目标：行 50%、分支 40%、函数 40%
