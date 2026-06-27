/**
 * Swagger / OpenAPI 配置与共享 Schema 定义
 *
 * 通过 @fastify/swagger 自动生成 OpenAPI 3.x 规范，
 * /docs/api 提供 Swagger UI 交互式文档。
 */
import type { FastifyInstance } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'

// ============================================================
// 公共响应 Schema
// ============================================================

/** 成功响应 (无 data) */
export const okResponseSchema = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const, const: true },
  },
}

/** 创建资源成功 */
export const createdResponseSchema = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const, const: true },
    data: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
      },
    },
  },
}

/** 错误响应 */
export const errorResponseSchema = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const, const: false },
    error: { type: 'string' as const },
  },
}

// ============================================================
// 数据模型 Schema
// ============================================================

export const userSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    username: { type: 'string' as const },
    display_name: { type: 'string' as const },
    role: { type: 'string' as const, enum: ['admin', 'member', 'guest'] },
    feishu_open_id: { type: 'string' as const },
    feishu_name: { type: 'string' as const },
    feishu_avatar_url: { type: 'string' as const },
    created_at: { type: 'string' as const },
    updated_at: { type: 'string' as const },
  },
}

export const projectSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    name: { type: 'string' as const },
    description: { type: 'string' as const },
    review_chain: { type: 'string' as const },
    created_at: { type: 'string' as const },
    updated_at: { type: 'string' as const },
  },
}

export const categorySchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    name: { type: 'string' as const },
    color: { type: 'string' as const },
    sort_order: { type: 'number' as const },
    project_id: { type: 'string' as const },
  },
}

export const featureSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    title: { type: 'string' as const },
    description: { type: 'string' as const },
    sections: { type: 'string' as const },
    is_custom: { type: 'boolean' as const },
    category_id: { type: 'string' as const },
    project_id: { type: 'string' as const },
    created_at: { type: 'string' as const },
    updated_at: { type: 'string' as const },
    // 列表接口的统计字段
    total_sections: { type: 'number' as const },
    approved_sections: { type: 'number' as const },
    completed_sections: { type: 'number' as const },
    edited_sections: { type: 'number' as const },
    orphaned_count: { type: 'number' as const },
  },
}

export const catalogSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    title: { type: 'string' as const },
    description: { type: 'string' as const },
    features: { type: 'string' as const },
    project_id: { type: 'string' as const },
    created_at: { type: 'string' as const },
    updated_at: { type: 'string' as const },
  },
}

export const loginRequestSchema = {
  type: 'object' as const,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string' as const },
    password: { type: 'string' as const },
  },
}

export const loginResponseSchema = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const, const: true },
    data: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' as const },
        user: userSchema,
      },
    },
  },
}

// ============================================================
// 配置 Swagger + Swagger UI
// ============================================================

export async function registerSwagger(app: FastifyInstance) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = app as any
  await instance.register(fastifySwagger, {
    openapi: {
      info: {
        title: '操作手册编写平台 API',
        description: '多项目操作手册编写与发布平台 RESTful API 文档',
        version: '0.1.0',
      },
      servers: [
        { url: 'http://localhost:3000', description: '本地开发服务器' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: '登录后获取的 JWT token',
          },
        },
      },
      tags: [
        { name: 'auth', description: '认证 — 登录 / 注册' },
        { name: 'projects', description: '项目管理' },
        { name: 'categories', description: '分类管理' },
        { name: 'features', description: '功能骨架管理' },
        { name: 'catalogs', description: '目录编排 + 发布' },
        { name: 'users', description: '用户管理' },
        { name: 'profile', description: '个人资料' },
        { name: 'todos', description: '待办汇总' },
        { name: 'upload', description: '文件上传' },
        { name: 'data-tasks', description: '数据导入导出' },
        { name: 'search', description: '全文搜索' },
        { name: 'ai', description: 'AI 写作助手' },
        { name: 'diff', description: '版本对比' },
        { name: 'audit', description: '审计日志' },
      ],
    },
  })

  await instance.register(fastifySwaggerUi, {
    routePrefix: '/docs/api',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
  })
}
