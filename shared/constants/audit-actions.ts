/**
 * 审计日志操作类型常量
 *
 * 命名规范：entity.action（小写英文，点分隔）
 * 所有操作类型及其中文标签集中定义，前后端共享
 */

export const AUDIT_ACTIONS = {
  // ======================== 项目 ========================
  'project.create': '创建项目',
  'project.update': '更新项目',
  'project.delete': '删除项目',
  'project.member_add': '添加项目成员',
  'project.member_remove': '移除项目成员',
  'project.review_chain_update': '更新审批链',

  // ======================== 功能/文档 ========================
  'feature.create': '创建功能',
  'feature.update': '更新功能',
  'feature.delete': '删除功能',
  'feature.sections_update': '更新功能章节',
  'feature.orphaned_delete': '删除游离文档',
  'document.status_change': '文档状态变更',
  'document.ensure': '创建协同文档',

  // ======================== 分类 ========================
  'category.create': '创建分类',
  'category.update': '更新分类',
  'category.delete': '删除分类',

  // ======================== 目录/发布 ========================
  'catalog.create': '创建目录',
  'catalog.update': '更新目录',
  'catalog.delete': '删除目录',
  'catalog.publish': '发布版本',
  'catalog.version_visibility': '更改版本可见性',

  // ======================== 用户与认证 ========================
  'user.create': '创建用户',
  'user.delete': '删除用户',
  'user.role_change': '角色变更',
  'user.password_change': '修改密码',
  'auth.login': '用户登录',
  'auth.login_failed': '登录失败',
  'auth.logout': '用户登出',
  'auth.feishu_login': '飞书登录',

  // ======================== 个人设置 ========================
  'profile.update_name': '修改显示名称',
  'profile.update_username': '修改用户名',
  'profile.update_notify': '更新通知偏好',
  'profile.bind_feishu': '绑定飞书账号',
  'profile.unbind_feishu': '解绑飞书账号',

  // ======================== 数据导入导出 ========================
  'data.export': '导出项目数据',
  'data.import_upload': '上传导入文件',
  'data.import_analyze': '分析导入差异',
  'data.import_apply': '应用导入数据',
  'data.task_delete': '删除数据任务',

  // ======================== 缓存管理 ========================
  'cache.clean': '清理过期缓存',
  'cache.invalidate': '失效导出缓存',
  'cache.entry_delete': '删除缓存条目',

  // ======================== 文件上传 ========================
  'upload.image': '上传图片',
  'upload.video': '上传视频',

  // ======================== 搜索索引 ========================
  'search.rebuild_index': '重建搜索索引',
} as const

export type AuditAction = keyof typeof AUDIT_ACTIONS

// ============================================================
// 按操作对象分类
// ============================================================

/** 操作对象中文标签 */
export const TARGET_TYPE_LABELS: Record<string, string> = {
  project: '项目',
  feature: '功能',
  document: '文档',
  category: '分类',
  catalog: '目录',
  'catalog-version': '目录版本',
  user: '用户',
  auth: '认证',
  profile: '个人设置',
  data: '数据导入导出',
  'data-task': '数据任务',
  cache: '缓存管理',
  'cache-export': '导出缓存',
  'cache-remote': '远程缓存',
  upload: '文件上传',
  search: '搜索索引',
}

/** 操作类型按对象分组（targetType → action[]） */
export const ACTIONS_BY_TARGET: Record<string, AuditAction[]> = {
  project: [
    'project.create',
    'project.update',
    'project.delete',
    'project.member_add',
    'project.member_remove',
    'project.review_chain_update',
  ],
  feature: [
    'feature.create',
    'feature.update',
    'feature.delete',
    'feature.sections_update',
    'feature.orphaned_delete',
  ],
  document: ['document.status_change', 'document.ensure'],
  category: ['category.create', 'category.update', 'category.delete'],
  catalog: [
    'catalog.create',
    'catalog.update',
    'catalog.delete',
    'catalog.publish',
    'catalog.version_visibility',
  ],
  user: ['user.create', 'user.delete', 'user.role_change', 'user.password_change'],
  auth: ['auth.login', 'auth.login_failed', 'auth.logout', 'auth.feishu_login'],
  profile: [
    'profile.update_name',
    'profile.update_username',
    'profile.update_notify',
    'profile.bind_feishu',
    'profile.unbind_feishu',
  ],
  data: [
    'data.export',
    'data.import_upload',
    'data.import_analyze',
    'data.import_apply',
    'data.task_delete',
  ],
  cache: ['cache.clean', 'cache.invalidate', 'cache.entry_delete'],
  upload: ['upload.image', 'upload.video'],
  search: ['search.rebuild_index'],
}

/** 高风险操作（红色标记） */
export const HIGH_RISK_ACTIONS = new Set<AuditAction>([
  'project.delete',
  'feature.delete',
  'catalog.delete',
  'user.delete',
  'data.import_apply',
])

/** 安全敏感操作（橙色标记） */
export const SECURITY_ACTIONS = new Set<AuditAction>([
  'auth.login_failed',
  'user.role_change',
  'user.password_change',
])
