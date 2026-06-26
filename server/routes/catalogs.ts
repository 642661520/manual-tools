import { FastifyInstance } from 'fastify'
import { rm } from 'fs/promises'
import { join } from 'path'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { isProjectMember, hasProjectRole } from '../auth/membership.js'
import { success, created, ok, fail } from '../lib/response.js'
import { v4 as uuid } from 'uuid'
import { assembleManual, assembleChapter } from '../services/manual-assembler.js'
import { buildMarkdownZip } from '../services/markdown-export.js'
import { buildStaticSite } from '../services/site-builder/index.js'
import type { CatalogRow, FeatureRow, CatalogFeatureEntry, CatalogEntry, CatalogVersionRow, CreateCatalogBody, UpdateCatalogBody } from '../types.js'
import { isCatalogPart } from '../types.js'

export async function catalogRoutes(app: FastifyInstance) {
  // 获取所有 catalog，支持按项目过滤
  app.get('/api/v1/catalogs', { preHandler: authMiddleware }, async (req, reply) => {
    const { projectId } = req.query as { projectId?: string }
    const db = getDb()
    const userId = req.user!.userId
    const role = req.user!.role

    if (projectId) {
      if (!isProjectMember(userId, role, projectId)) {
        return fail(reply, 403, '你不是该项目的成员')
      }
      const rows = db.prepare('SELECT * FROM catalogs WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
      return success(rows)
    }
    // 无项目过滤时，仅返回用户有成员身份的项目中的 catalog
    if (role === 'admin') {
      const rows = db.prepare('SELECT * FROM catalogs ORDER BY updated_at DESC').all()
      return success(rows)
    }
    const rows = db.prepare(`
      SELECT c.* FROM catalogs c
      JOIN project_members pm ON c.project_id = pm.project_id AND pm.user_id = ?
      ORDER BY c.updated_at DESC
    `).all(userId)
    return success(rows)
  })

  // 预览手册（仅返回结构化数据，不含 markdown）
  app.get('/api/v1/catalogs/:id/preview', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }
    const manual = assembleManual(id, { approvedOnly: mode === 'approved' })
    if (!manual) return fail(reply, 404, 'Catalog not found')
    // 不返回 markdown，前端按需从 chapters 端点获取
    return success({
      catalog: manual.catalog,
      features: manual.features,
      headings: manual.headings,
    })
  })

  // 预览单章
  app.get('/api/v1/catalogs/:id/chapters/:chNum', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, chNum: chNumStr } = req.params as { id: string; chNum: string }
    const { mode } = req.query as { mode?: string }
    const chNum = parseInt(chNumStr)
    if (isNaN(chNum) || chNum < 1) return fail(reply, 400, '无效的章节编号')
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }
    const chapter = assembleChapter(id, chNum, { approvedOnly: mode === 'approved' })
    if (!chapter) return fail(reply, 404, '章节不存在')
    return success(chapter)
  })

  // 版本列表
  app.get('/api/v1/catalogs/:id/versions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }
    const rows = db.prepare(
      'SELECT id, version_major, version_minor, title, change_notes, visibility, created_at FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
    ).all(id) as (Pick<CatalogVersionRow, 'id' | 'version_major' | 'version_minor' | 'title' | 'change_notes' | 'visibility' | 'created_at'>)[]
    return success(rows)
  })

  // 历史版本预览（仅返回结构化数据，不含 markdown）
  app.get('/api/v1/catalogs/:id/versions/:versionId/preview', { preHandler: authMiddleware }, async (req, reply) => {
    const { versionId } = req.params as { versionId: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()
    const ver = db.prepare('SELECT * FROM catalog_versions WHERE id = ?').get(versionId) as CatalogVersionRow | undefined
    if (!ver) return fail(reply, 404, 'Version not found')

    // 校验项目成员
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(ver.catalog_id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    // 模式筛选时重新组装，使用快照的审核状态
    if (mode === 'approved') {
      const statusOv = JSON.parse(ver.status_snapshot || '{}') as Record<string, string>
      const manual = assembleManual(ver.catalog_id, { approvedOnly: true, featureOverride: ver.features_snapshot, statusOverride: statusOv })
      if (!manual) return fail(reply, 404, 'Catalog not found')
      return success({
        versionMajor: ver.version_major,
        versionMinor: ver.version_minor,
        title: ver.title,
        features: manual.features,
        headings: manual.headings,
        entries: manual.catalog.entries,
        changeNotes: ver.change_notes,
        createdAt: ver.created_at,
      })
    }

    return success({
      versionMajor: ver.version_major,
      versionMinor: ver.version_minor,
      title: ver.title,
      features: JSON.parse(ver.features_json || '[]'),
      headings: JSON.parse(ver.headings_json || '[]'),
      entries: JSON.parse(ver.features_snapshot || '[]'),
      changeNotes: ver.change_notes,
      createdAt: ver.created_at,
    })
  })

  // 历史版本单章预览
  app.get('/api/v1/catalogs/:id/versions/:versionId/chapters/:chNum', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, versionId, chNum: chNumStr } = req.params as { id: string; versionId: string; chNum: string }
    const { mode } = req.query as { mode?: string }
    const chNum = parseInt(chNumStr)
    if (isNaN(chNum) || chNum < 1) return fail(reply, 400, '无效的章节编号')
    const db = getDb()
    const ver = db.prepare('SELECT * FROM catalog_versions WHERE id = ?').get(versionId) as CatalogVersionRow | undefined
    if (!ver) return fail(reply, 404, 'Version not found')

    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    const approvedOnly = mode === 'approved'
    const statusOv = approvedOnly ? JSON.parse(ver.status_snapshot || '{}') as Record<string, string> : undefined
    const chapter = assembleChapter(ver.catalog_id, chNum, {
      approvedOnly,
      featureOverride: ver.features_snapshot,
      statusOverride: statusOv,
    })
    if (!chapter) return fail(reply, 404, '章节不存在')
    return success(chapter)
  })

  // 导出 Markdown 压缩包（md + 图片）
  app.get('/api/v1/catalogs/:id/export/markdown', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, '目录不存在')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }
    const manual = assembleManual(id)
    if (!manual) {
      return fail(reply, 404, '目录不存在')
    }

    try {
      const { stream, filename } = await buildMarkdownZip(manual)
      reply.header('Content-Type', 'application/zip')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
      return reply.send(stream)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.error(`Markdown export failed: ${msg}`)
      return fail(reply, 500, '导出失败')
    }
  })

  // 发布版本（项目 pm+ 可操作）
  app.post('/api/v1/catalogs/:id/publish', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { changeNotes?: string; visibility?: string }
    const visibility = (['public', 'login_required', 'project_members'].includes(body.visibility || '') ? body.visibility : 'project_members') as string
    const db = getDb()

    const catalogMeta = db.prepare('SELECT project_id, title, features FROM catalogs WHERE id = ?').get(id) as { project_id: string; title: string; features: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    const fullManual = assembleManual(id)
    if (!fullManual) return fail(reply, 404, 'Catalog not found')

    const currentFeatures = catalogMeta.features

    // 版本号计算：与上一版本对比 features_snapshot
    const prevVer = db.prepare(
      'SELECT version_major, version_minor, features_snapshot FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC LIMIT 1',
    ).get(id) as { version_major: number; version_minor: number; features_snapshot: string } | undefined

    let major: number, minor: number
    if (prevVer) {
      if (prevVer.features_snapshot !== currentFeatures) {
        major = prevVer.version_major + 1
        minor = 0
      } else {
        major = prevVer.version_major
        minor = prevVer.version_minor + 1
      }
    } else {
      major = 1
      minor = 0
    }

    // 收集审核状态快照（展平 Part 结构）
    const featuresListRaw: CatalogEntry[] = JSON.parse(currentFeatures)
    const featuresList: CatalogFeatureEntry[] = []
    for (const entry of featuresListRaw) {
      if (isCatalogPart(entry)) {
        featuresList.push(...entry.features)
      } else {
        featuresList.push(entry)
      }
    }
    const statusSnapshot: Record<string, string> = {}
    for (const fe of featuresList) {
      const f = db.prepare('SELECT sections FROM features WHERE id = ?').get(fe.featureId) as { sections: string } | undefined
      if (!f) continue
      const secs = JSON.parse(f.sections || '[]') as { key: string }[]
      for (const s of secs) {
        const docId = `${fe.featureId}/${s.key}`
        const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(docId) as { status: string } | undefined
        if (doc) statusSnapshot[docId] = doc.status
      }
    }

    const versionId = uuid().slice(0, 8)
    db.prepare(`
      INSERT INTO catalog_versions (id, catalog_id, version_major, version_minor, title, features_snapshot, change_notes, markdown, status_snapshot, visibility, features_json, headings_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId, id, major, minor, fullManual.catalog.title,
      currentFeatures, body.changeNotes || '', fullManual.markdown,
      JSON.stringify(statusSnapshot), visibility,
      JSON.stringify(fullManual.features), JSON.stringify(fullManual.headings),
    )

    // 构建静态文档站点
    const versionLabel = `v${major}.${minor}`
    buildStaticSite(id, versionLabel).catch(err => {
      app.log.error(`静态站点构建失败: ${err instanceof Error ? err.message : err}`)
    })

    return success({ id: versionId, versionMajor: major, versionMinor: minor })
  })

  // 更新版本可见性
  app.put('/api/v1/catalogs/:id/versions/:versionId/visibility', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string }
    const body = req.body as { visibility: string }
    if (!['public', 'login_required', 'project_members'].includes(body.visibility)) {
      return fail(reply, 400, '无效的可见性设置')
    }

    const db = getDb()
    const ver = db.prepare('SELECT catalog_id FROM catalog_versions WHERE id = ?').get(versionId) as { catalog_id: string } | undefined
    if (!ver || ver.catalog_id !== id) return fail(reply, 404, '版本不存在')

    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return fail(reply, 404, '目录不存在')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    db.prepare('UPDATE catalog_versions SET visibility = ? WHERE id = ?').run(body.visibility, versionId)
    return ok()
  })

  // 获取单个 catalog
  app.get('/api/v1/catalogs/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as CatalogRow | undefined
    if (!catalog) return fail(reply, 404, 'Not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalog.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    // 加载 features 详情用于展示（保留 Part 结构）
    const entries: CatalogEntry[] = JSON.parse(catalog.features)
    // 展平收集所有 featureId
    const allFeatureIds: string[] = []
    for (const entry of entries) {
      if (isCatalogPart(entry)) {
        allFeatureIds.push(...entry.features.map(f => f.featureId))
      } else {
        allFeatureIds.push(entry.featureId)
      }
    }
    const features = allFeatureIds.length > 0
      ? db.prepare(`SELECT * FROM features WHERE id IN (${allFeatureIds.map(() => '?').join(',')})`).all(...allFeatureIds) as FeatureRow[]
      : []

    // 按 catalog 中的顺序排列，并应用 sectionOrder
    const featureMap = new Map(features.map(f => [f.id, f]))
    function resolveFeature(fe: CatalogFeatureEntry) {
      const f = featureMap.get(fe.featureId)
      if (!f) return null
      const sections = JSON.parse(f.sections || '[]') as { key: string; title: string; description?: string }[]
      const ordered = fe.sectionOrder
        ? fe.sectionOrder.map(k => sections.find(s => s.key === k)).filter(Boolean) as typeof sections
        : sections
      return { ...f, sections: ordered, sectionOrder: fe.sectionOrder }
    }

    const orderedFeatures = entries.map(entry => {
      if (isCatalogPart(entry)) {
        const resolvedFeatures = entry.features.map(resolveFeature).filter(Boolean)
        return { type: 'part' as const, id: entry.id, title: entry.title, features: resolvedFeatures }
      }
      return resolveFeature(entry)
    }).filter(Boolean)

    return success({
      ...catalog,
      targets: JSON.parse(catalog.targets),
      coverInfo: JSON.parse(catalog.cover_info),
      features: orderedFeatures,
    })
  })

  // 创建 catalog
  app.post('/api/v1/catalogs', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const body = req.body as CreateCatalogBody
    const projectId = body.projectId || 'default'

    if (!hasProjectRole(req.user!.userId, req.user!.role, projectId, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    const id = uuid().slice(0, 8)
    const db = getDb()

    db.prepare(`
      INSERT INTO catalogs (id, title, targets, features, cover_info, project_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.title || '未命名目录',
      JSON.stringify(body.targets || []),
      JSON.stringify(body.features || []),
      JSON.stringify(body.cover || {}),
      projectId,
    )

    return created(id)
  })

  // 更新 catalog
  app.put('/api/v1/catalogs/:id', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateCatalogBody
    const db = getDb()

    const existing = db.prepare('SELECT id, project_id FROM catalogs WHERE id = ?').get(id) as { id: string; project_id: string } | undefined
    if (!existing) return fail(reply, 404, 'Not found')

    if (!hasProjectRole(req.user!.userId, req.user!.role, existing.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    db.prepare(`
      UPDATE catalogs SET
        title = ?, targets = ?, features = ?, cover_info = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      body.title,
      JSON.stringify(body.targets || []),
      JSON.stringify(body.features || []),
      JSON.stringify(body.cover || {}),
      id,
    )

    return ok()
  })

  // 删除 catalog
  app.delete('/api/v1/catalogs/:id', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const catalog = db.prepare('SELECT id, project_id FROM catalogs WHERE id = ?').get(id) as { id: string; project_id: string } | undefined
    if (!catalog) return fail(reply, 404, 'Not found')

    if (!hasProjectRole(req.user!.userId, req.user!.role, catalog.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    db.prepare('DELETE FROM catalogs WHERE id = ?').run(id)

    // 清理静态文档站点文件
    const docsDir = join(process.cwd(), 'data/docs', id)
    rm(docsDir, { recursive: true, force: true }).catch(err => {
      app.log.error(`清理文档站点失败 (catalog ${id}): ${err instanceof Error ? err.message : err}`)
    })

    return ok()
  })
}
