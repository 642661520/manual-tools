/**
 * Swagger / OpenAPI 配置与共享 Schema 定义
 *
 * 通过 @fastify/swagger 自动生成 OpenAPI 3.x 规范，
 * /docs/api 提供 Swagger UI 交互式文档。
 */
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
