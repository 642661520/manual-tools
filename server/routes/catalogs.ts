import { FastifyInstance } from 'fastify'
import { rm } from 'fs/promises'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { isProjectMember, hasProjectRole, assertCatalogMember } from '../auth/membership.js'
import { recordAudit } from '../services/audit.js'
import { success, created, ok, fail } from '../lib/response.js'
import { v4 as uuid } from 'uuid'
import { assembleManual, assembleChapter, extractChapterMarkdown } from '../services/manual-assembler.js'
import { buildMarkdownZip } from '../services/markdown-export.js'
import { buildPdf } from '../services/pdf-export.js'
import { buildStaticSite } from '../services/site-builder/index.js'
import { computeFingerprint, computeOptionsHash, getCachedExport, saveCachedExport } from '../services/export-cache.js'
import type { CatalogRow, FeatureRow, CatalogFeatureEntry, CatalogEntry, CatalogVersionRow, CreateCatalogBody, UpdateCatalogBody, FeatureData } from '../types.js'
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
    const member = assertCatalogMember(db, id, req.user!.userId, req.user!.role)
    if (!member) return fail(reply, 404, 'Catalog not found')
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
    const member = assertCatalogMember(db, id, req.user!.userId, req.user!.role)
    if (!member) return fail(reply, 404, 'Catalog not found')
    const chapter = assembleChapter(id, chNum, { approvedOnly: mode === 'approved' })
    if (!chapter) return fail(reply, 404, '章节不存在')
    return success(chapter)
  })

  // 版本列表
  app.get('/api/v1/catalogs/:id/versions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const member = assertCatalogMember(db, id, req.user!.userId, req.user!.role)
    if (!member) return fail(reply, 404, 'Catalog not found')
    const rows = db.prepare(
      'SELECT id, version_major, version_minor, title, change_notes, visibility, publish_scope, created_at FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
    ).all(id) as (Pick<CatalogVersionRow, 'id' | 'version_major' | 'version_minor' | 'title' | 'change_notes' | 'visibility' | 'publish_scope' | 'created_at'>)[]
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
    const member = assertCatalogMember(db, ver.catalog_id, req.user!.userId, req.user!.role)
    if (!member) return fail(reply, 404, 'Catalog not found')

    // 模式筛选时重新组装，使用快照的审核状态
    if (mode === 'approved') {
      const statusOv = JSON.parse(ver.status_snapshot || '{}') as Record<string, string>
      const featuresData = JSON.parse(ver.features_json || '[]') as FeatureData[]
      const manual = assembleManual(ver.catalog_id, { approvedOnly: true, featureOverride: ver.features_snapshot, statusOverride: statusOv, featuresData })
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
        publishScope: ver.publish_scope,
        statusSnapshot: JSON.parse(ver.status_snapshot || '{}'),
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
      publishScope: ver.publish_scope,
      statusSnapshot: JSON.parse(ver.status_snapshot || '{}'),
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
    const entries: CatalogEntry[] = JSON.parse(ver.features_snapshot || '[]')
    const hasParts = entries.some(isCatalogPart)

    // 展平 entries 获取章节总数与当前章节元信息
    const flat: { featureId: string; sectionOrder?: string[]; partTitle?: string; partIdx?: number }[] = []
    let partIdx = 0
    for (const entry of entries) {
      if (isCatalogPart(entry)) {
        partIdx++
        for (const fe of entry.features) {
          flat.push({ featureId: fe.featureId, sectionOrder: fe.sectionOrder, partTitle: entry.title, partIdx })
        }
      } else {
        flat.push({ featureId: entry.featureId, sectionOrder: entry.sectionOrder })
      }
    }
    const totalChapters = flat.length
    if (chNum < 1 || chNum > totalChapters) return fail(reply, 404, '章节不存在')
    const target = flat[chNum - 1]

    const featuresData = JSON.parse(ver.features_json || '[]') as FeatureData[]
    const feature = featuresData.find(f => f.id === target.featureId)

    // 审核模式：需要重组装以过滤未审核内容
    if (approvedOnly) {
      const statusOv = JSON.parse(ver.status_snapshot || '{}') as Record<string, string>
      const chapter = assembleChapter(ver.catalog_id, chNum, {
        approvedOnly: true,
        featureOverride: ver.features_snapshot,
        statusOverride: statusOv,
        featuresData,
      })
      if (!chapter) return fail(reply, 404, '章节不存在')
      return success(chapter)
    }

    // 非审核模式：直接从存储的 markdown 提取（文档内容可能已被删除）
    const chapterMd = extractChapterMarkdown(ver.markdown, chNum)
    if (chapterMd === null) return fail(reply, 404, '章节不存在')

    // 从 headings 快照中筛选本章标题
    const chId = `ch${chNum}`
    const allHeadings = JSON.parse(ver.headings_json || '[]') as Array<{ level: number; text: string; id: string }>
    const chHeadIdx = allHeadings.findIndex(h => h.id === chId)
    const chapterHeadings: Array<{ level: number; text: string; id: string }> = []
    if (chHeadIdx !== -1) {
      // 收集本章标题 + 后续子标题直到遇到下一个 ch 或 part 锚点
      for (let i = chHeadIdx; i < allHeadings.length; i++) {
        const h = allHeadings[i]
        if (i > chHeadIdx && (h.id.startsWith('ch') || h.id.startsWith('part-'))) break
        chapterHeadings.push(h)
      }
    }

    // 调整本章内 headings 的层级（使章节标题成为最高级）
    const baseLevel = chapterHeadings.length > 0 ? chapterHeadings[0].level : 2
    const shiftedHeadings = chapterHeadings.map(h => ({
      ...h,
      level: Math.max(1, h.level - baseLevel + 2),
    }))

    // 如果章节属于某个 Part，在 markdown 前补上 Part 标题
    let finalMd = chapterMd
    const finalHeadings = [...shiftedHeadings]
    if (target.partTitle && target.partIdx != null) {
      const partId = `part-${target.partIdx}`
      finalMd = `## <a id="${partId}"></a>${target.partTitle}\n\n${chapterMd}`
      finalHeadings.unshift({ level: 2, text: target.partTitle, id: partId })
    }

    return success({
      chNum,
      featureId: target.featureId,
      featureTitle: feature?.title || '',
      markdown: finalMd,
      headings: finalHeadings,
      totalChapters,
      hasParts,
      partTitle: target.partTitle,
      partIdx: target.partIdx,
    })
  })

  // 导出 Markdown 压缩包（md + 图片）
  app.get('/api/v1/catalogs/:id/export/markdown', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id, title FROM catalogs WHERE id = ?').get(id) as { project_id: string; title: string } | undefined
    if (!catalogMeta) return fail(reply, 404, '目录不存在')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    // 计算指纹 + 参数哈希，尝试命中缓存
    const fingerprint = computeFingerprint(id)
    const optionsHash = computeOptionsHash({})
    const cached = getCachedExport(id, 'markdown', fingerprint, optionsHash)
    if (cached) {
      const buf = readFileSync(cached.filePath)
      reply.header('Content-Type', 'application/zip')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(cached.fileName)}"`)
      return reply.send(buf)
    }

    const manual = assembleManual(id)
    if (!manual) {
      return fail(reply, 404, '目录不存在')
    }

    try {
      const { stream, filename } = await buildMarkdownZip(manual)
      // 收集 stream 为 Buffer（用于缓存）
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve)
        stream.on('error', reject)
      })
      const zipBuffer = Buffer.concat(chunks)

      // 保存缓存
      saveCachedExport(id, 'markdown', fingerprint, optionsHash, zipBuffer, filename)

      reply.header('Content-Type', 'application/zip')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
      return reply.send(zipBuffer)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.error(`Markdown export failed: ${msg}`)
      return fail(reply, 500, '导出失败')
    }
  })

  // 导出草稿 PDF（项目 pm+ 可操作）
  app.get('/api/v1/catalogs/:id/export/pdf', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id, title FROM catalogs WHERE id = ?').get(id) as { project_id: string; title: string } | undefined
    if (!catalogMeta) return fail(reply, 404, '目录不存在')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    // 计算指纹 + 参数哈希，尝试命中缓存
    const options = { mode: mode || '', approvedOnly: mode === 'approved' }
    const fingerprint = computeFingerprint(id)
    const optionsHash = computeOptionsHash(options)
    const cached = getCachedExport(id, 'pdf', fingerprint, optionsHash)
    if (cached) {
      const buf = readFileSync(cached.filePath)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(cached.fileName)}"`)
      return reply.send(buf)
    }

    const manual = assembleManual(id, { approvedOnly: mode === 'approved' })
    if (!manual) return fail(reply, 404, '目录不存在')

    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      const pdfBuffer = await buildPdf(manual, {
        headerText: catalogMeta.title,
        footerText: `草稿 · ${dateStr}`,
      })
      const safeTitle = catalogMeta.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)
      const fileName = `${safeTitle}-draft-${dateStr}.pdf`

      // 保存缓存
      saveCachedExport(id, 'pdf', fingerprint, optionsHash, pdfBuffer, fileName)

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
      return reply.send(pdfBuffer)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.error(`PDF export failed: ${msg}`)
      return fail(reply, 500, 'PDF 导出失败')
    }
  })

  // 历史版本导出 PDF
  app.get('/api/v1/catalogs/:id/versions/:versionId/export/pdf', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()

    const ver = db.prepare('SELECT * FROM catalog_versions WHERE id = ?').get(versionId) as CatalogVersionRow | undefined
    if (!ver || ver.catalog_id !== id) return fail(reply, 404, '版本不存在')

    const catalogMeta = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as CatalogRow | undefined
    if (!catalogMeta) return fail(reply, 404, '目录不存在')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    // 版本内容不可变，指纹基于版本快照数据
    const options = { mode: mode || '', approvedOnly: mode === 'approved' }
    const fingerprint = computeFingerprint(id) + '-' + versionId.slice(0, 8)
    const optionsHash = computeOptionsHash(options)
    const cached = getCachedExport(id, 'pdf', fingerprint, optionsHash)
    if (cached) {
      const buf = readFileSync(cached.filePath)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(cached.fileName)}"`)
      return reply.send(buf)
    }

    // 尝试从快照重新组装（以支持 mode=approved 过滤）
    const approvedOnly = mode === 'approved'
    const statusOv = approvedOnly ? JSON.parse(ver.status_snapshot || '{}') as Record<string, string> : undefined
    const featuresData = JSON.parse(ver.features_json || '[]') as FeatureData[]
    const manual = assembleManual(ver.catalog_id, {
      approvedOnly,
      featureOverride: ver.features_snapshot,
      statusOverride: statusOv,
      featuresData,
    })

    const versionLabel = `v${ver.version_major}.${ver.version_minor}`

    try {
      const pdfBuffer = await buildPdf(
        manual || {
          catalog: {
            id: catalogMeta.id,
            title: catalogMeta.title,
            project_id: catalogMeta.project_id,
            created_at: catalogMeta.created_at,
            updated_at: catalogMeta.updated_at,
            targets: JSON.parse(catalogMeta.targets),
            coverInfo: JSON.parse(catalogMeta.cover_info || '{}'),
            entries: JSON.parse(ver.features_snapshot || '[]') as CatalogEntry[],
          },
          features: JSON.parse(ver.features_json || '[]'),
          markdown: ver.markdown,
          headings: JSON.parse(ver.headings_json || '[]'),
        },
        {
          headerText: ver.title || catalogMeta.title,
          footerText: versionLabel,
        },
      )
      const safeTitle = (ver.title || catalogMeta.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)
      const fileName = `${safeTitle}-${versionLabel}.pdf`

      // 保存缓存
      saveCachedExport(id, 'pdf', fingerprint, optionsHash, pdfBuffer, fileName)

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
      return reply.send(pdfBuffer)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.error(`PDF export failed: ${msg}`)
      return fail(reply, 500, 'PDF 导出失败')
    }
  })

  // 发布版本（项目 pm+ 可操作）
  app.post('/api/v1/catalogs/:id/publish', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { changeNotes?: string; visibility?: string; approvedOnly?: boolean }
    const visibility = (['public', 'login_required', 'project_members'].includes(body.visibility || '') ? body.visibility : 'project_members') as string
    const approvedOnly = body.approvedOnly !== false
    const db = getDb()

    const catalogMeta = db.prepare('SELECT project_id, title, features FROM catalogs WHERE id = ?').get(id) as { project_id: string; title: string; features: string } | undefined
    if (!catalogMeta) return fail(reply, 404, 'Catalog not found')
    if (!hasProjectRole(req.user!.userId, req.user!.role, catalogMeta.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    // 收集审核状态快照（展平 Part 结构）
    const featuresListRaw: CatalogEntry[] = JSON.parse(catalogMeta.features)
    const featuresList: CatalogFeatureEntry[] = []
    for (const entry of featuresListRaw) {
      if (isCatalogPart(entry)) { featuresList.push(...entry.features) }
      else { featuresList.push(entry) }
    }
    const statusSnapshot: Record<string, string> = {}
    const featureNames: Record<string, string> = {}
    for (const fe of featuresList) {
      const f = db.prepare('SELECT title, sections FROM features WHERE id = ?').get(fe.featureId) as { title: string; sections: string } | undefined
      if (!f) continue
      featureNames[fe.featureId] = f.title
      const secs = JSON.parse(f.sections || '[]') as { key: string; title: string }[]
      for (const s of secs) {
        const docId = `${fe.featureId}/${s.key}`
        const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(docId) as { status: string } | undefined
        statusSnapshot[docId] = doc?.status || 'draft'
      }
    }

    // 审核检查
    const unreviewed = Object.entries(statusSnapshot)
      .filter(([, s]) => s !== 'approved')
      .map(([docId, s]) => {
        const [fid] = docId.split('/')
        return { docId, status: s, featureTitle: featureNames[fid] || fid }
      })

    if (approvedOnly && unreviewed.length > 0) {
      const detail = unreviewed
        .slice(0, 10)
        .map(u => `${u.featureTitle}: ${u.status}`)
        .join('; ')
      const more = unreviewed.length > 10 ? ` 等共 ${unreviewed.length} 个` : ''
      return fail(reply, 400,
        `以下 ${unreviewed.length} 个章节未通过审核：${detail}${more}。\n若要强制发布，请勾选「允许未审核内容发布」。`,
      )
    }

    const fullManual = assembleManual(id, { approvedOnly })
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

    const versionId = uuid().slice(0, 8)
    const scope = approvedOnly ? 'approved_only' : 'all'
    db.prepare(`
      INSERT INTO catalog_versions (id, catalog_id, version_major, version_minor, title, features_snapshot, change_notes, markdown, status_snapshot, visibility, features_json, headings_json, publish_scope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId, id, major, minor, fullManual.catalog.title,
      currentFeatures, body.changeNotes || '', fullManual.markdown,
      JSON.stringify(statusSnapshot), visibility,
      JSON.stringify(fullManual.features), JSON.stringify(fullManual.headings), scope,
    )

    // 构建静态文档站点
    const versionLabel = `v${major}.${minor}`
    buildStaticSite(id, versionLabel).catch(err => {
      app.log.error(`静态站点构建失败: ${err instanceof Error ? err.message : err}`)
    })

    recordAudit({
      userId: req.user!.userId,
      username: req.user?.username || '',
      action: 'catalog.publish',
      targetType: 'catalog',
      targetId: id,
      detail: { versionMajor: major, versionMinor: minor, title: catalogMeta.title, visibility, approvedOnly },
    })

    return success({
      id: versionId,
      versionMajor: major,
      versionMinor: minor,
      approved: unreviewed.length,
      total: Object.keys(statusSnapshot).length,
    })
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

    recordAudit({
      userId: req.user!.userId,
      username: req.user?.username || '',
      action: 'catalog.delete',
      targetType: 'catalog',
      targetId: id,
    })

    // 清理静态文档站点文件
    const docsDir = join(process.cwd(), 'data/docs', id)
    rm(docsDir, { recursive: true, force: true }).catch(err => {
      app.log.error(`清理文档站点失败 (catalog ${id}): ${err instanceof Error ? err.message : err}`)
    })

    return ok()
  })
}
