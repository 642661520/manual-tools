import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { isProjectMember } from '../auth/membership.js'
import { v4 as uuid } from 'uuid'
import { assembleManual, generateHtml, addPdfOutline } from '../services/pdf-generator.js'
import { buildMarkdownZip } from '../services/markdown-export.js'
import type { CatalogRow, FeatureRow, CatalogFeatureEntry, CatalogVersionRow, CreateCatalogBody, UpdateCatalogBody } from '../types.js'

interface LaunchOptions {
  headless: boolean
  args: string[]
  executablePath?: string
}

export async function catalogRoutes(app: FastifyInstance) {
  // 获取所有 catalog，支持按项目过滤
  app.get('/api/catalogs', { preHandler: authMiddleware }, async (req) => {
    const { projectId } = req.query as { projectId?: string }
    const db = getDb()
    if (projectId) {
      return db.prepare('SELECT * FROM catalogs WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
    }
    return db.prepare('SELECT * FROM catalogs ORDER BY updated_at DESC').all()
  })

  // 预览手册
  app.get('/api/catalogs/:id/preview', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return reply.status(404).send({ error: 'Catalog not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }
    const manual = assembleManual(id, { approvedOnly: mode === 'approved' })
    if (!manual) return reply.status(404).send({ error: 'Catalog not found' })
    return manual
  })

  // 版本列表
  app.get('/api/catalogs/:id/versions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return reply.status(404).send({ error: 'Catalog not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }
    return db.prepare(
      'SELECT id, version_major, version_minor, title, change_notes, created_at FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
    ).all(id) as (Pick<CatalogVersionRow, 'id' | 'version_major' | 'version_minor' | 'title' | 'change_notes' | 'created_at'>)[]
  })

  // 历史版本预览
  app.get('/api/catalogs/:id/versions/:versionId/preview', { preHandler: authMiddleware }, async (req, reply) => {
    const { versionId } = req.params as { versionId: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()
    const ver = db.prepare('SELECT * FROM catalog_versions WHERE id = ?').get(versionId) as CatalogVersionRow | undefined
    if (!ver) return reply.status(404).send({ error: 'Version not found' })

    // 校验项目成员
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(ver.catalog_id) as { project_id: string } | undefined
    if (!catalogMeta) return reply.status(404).send({ error: 'Catalog not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    // 模式筛选时重新组装，使用快照的审核状态
    if (mode === 'approved') {
      const statusOv = JSON.parse(ver.status_snapshot || '{}') as Record<string, string>
      const manual = assembleManual(ver.catalog_id, { approvedOnly: true, featureOverride: ver.features_snapshot, statusOverride: statusOv })
      if (!manual) return reply.status(404).send({ error: 'Catalog not found' })
      return {
        versionMajor: ver.version_major,
        versionMinor: ver.version_minor,
        title: ver.title,
        markdown: manual.markdown,
        changeNotes: ver.change_notes,
        created_at: ver.created_at,
      }
    }

    return {
      versionMajor: ver.version_major,
      versionMinor: ver.version_minor,
      title: ver.title,
      markdown: ver.markdown,
      changeNotes: ver.change_notes,
      created_at: ver.created_at,
    }
  })

  // 导出 Markdown 压缩包（md + 图片）
  app.get('/api/catalogs/:id/export/markdown', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const manual = assembleManual(id)
    if (!manual) {
      return reply.status(404).send({ error: '目录不存在' })
    }

    try {
      const { stream, filename } = await buildMarkdownZip(manual)
      reply.header('Content-Type', 'application/zip')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
      return reply.send(stream)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Markdown export failed:', msg)
      return reply.status(500).send({ error: '导出失败' })
    }
  })

  // 历史版本导出 PDF
  app.get('/api/catalogs/:id/versions/:versionId/export', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()
    const ver = db.prepare('SELECT * FROM catalog_versions WHERE id = ?').get(versionId) as CatalogVersionRow | undefined
    if (!ver) return reply.status(404).send({ error: 'Version not found' })
    if (ver.catalog_id !== id) return reply.status(400).send({ error: 'Version does not belong to this catalog' })

    // 校验项目成员
    const catalogMeta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as { project_id: string } | undefined
    if (!catalogMeta) return reply.status(404).send({ error: 'Catalog not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    // 模式筛选时重新组装，使用快照的审核状态
    const manual = mode === 'approved'
      ? assembleManual(id, { approvedOnly: true, featureOverride: ver.features_snapshot, statusOverride: JSON.parse(ver.status_snapshot || '{}') as Record<string, string> })
      : null
    const markdown = manual?.markdown || ver.markdown

    const project = db.prepare('SELECT name FROM projects WHERE id = (SELECT project_id FROM catalogs WHERE id = ?)').get(id) as { name: string } | undefined
    const headerText = project?.name || ver.title
    const versionLabel = `v${ver.version_major}.${ver.version_minor}`

    // 追加变更记录（仅显示截至当前版本及之前的记录）
    const allHistory = db.prepare(
      'SELECT version_major, version_minor, change_notes, created_at FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major, version_minor',
    ).all(id) as { version_major: number; version_minor: number; change_notes: string; created_at: string }[]
    const versionHistory = allHistory.filter(v =>
      v.version_major < ver.version_major ||
      (v.version_major === ver.version_major && v.version_minor <= ver.version_minor)
    )
    let md = markdown
    if (versionHistory.length > 0) {
      md += '\n\n---\n\n## 变更记录\n\n'
      for (const v of versionHistory) {
        const date = v.created_at.slice(0, 10)
        md += `- **v${v.version_major}.${v.version_minor}** (${date}) ${v.change_notes || ''}\n`
      }
    }

    const html = generateHtml({
      catalog: { title: ver.title, project_id: '', id, created_at: '', updated_at: '', targets: [], coverInfo: {} },
      features: [],
      markdown: md,
      headings: [],
    })
    if (!html) return reply.status(404).send({ error: 'Generate failed' })

    try {
      const puppeteer = await import('puppeteer')
      const launchOpts: LaunchOptions = {
        headless: true,
        args: process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
      }
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
      }
      const browser = await puppeteer.launch(launchOpts)
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {})
      // 等待所有图片加载完成（包括外链），超时不阻塞导出
      await page.evaluate(`Array.from(document.images).filter(i=>!i.complete).forEach(i=>{i.onload=i.onerror=()=>{};setTimeout(()=>{},1e4)})`).catch(() => {})
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2.5cm' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:10px;text-align:center;width:100%;color:#9ca3af;">${headerText}</div>`,
        footerTemplate: `<div style="font-size:10px;text-align:center;width:100%;color:#9ca3af;">${versionLabel} · 第 <span class="pageNumber"></span> 页 / <span class="totalPages"></span> 页</div>`,
      })
      await browser.close()
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(ver.title)}-${versionLabel}.pdf"`)
      return pdf
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return html.replace('</body>', `<p style="color:red;">PDF 生成失败：${msg}</p></body>`)
    }
  })

  // 发布版本（PM only，不绑定 PDF 导出）
  app.post('/api/catalogs/:id/publish', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { changeNotes?: string }
    const db = getDb()

    const catalogMeta = db.prepare('SELECT project_id, title, features FROM catalogs WHERE id = ?').get(id) as { project_id: string; title: string; features: string } | undefined
    if (!catalogMeta) return reply.status(404).send({ error: 'Catalog not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    const fullManual = assembleManual(id)
    if (!fullManual) return reply.status(404).send({ error: 'Catalog not found' })

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

    // 收集审核状态快照
    const featuresList: { featureId: string; sectionOrder?: string[] }[] = JSON.parse(currentFeatures)
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
      INSERT INTO catalog_versions (id, catalog_id, version_major, version_minor, title, features_snapshot, change_notes, markdown, status_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId, id, major, minor, fullManual.catalog.title,
      currentFeatures, body.changeNotes || '', fullManual.markdown,
      JSON.stringify(statusSnapshot),
    )

    return { id: versionId, versionMajor: major, versionMinor: minor }
  })

  // 导出草稿 PDF（PM only，不创建版本）
  app.get('/api/catalogs/:id/export', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { mode } = req.query as { mode?: string }
    const db = getDb()

    const catalogMeta = db.prepare('SELECT project_id, title FROM catalogs WHERE id = ?').get(id) as { project_id: string; title: string } | undefined
    if (!catalogMeta) return reply.status(404).send({ error: 'Catalog not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalogMeta.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    // 导出内容按 mode 过滤
    const manual = assembleManual(id, { approvedOnly: mode === 'approved' })
    if (!manual) return reply.status(404).send({ error: 'Catalog not found' })

    // 获取项目名称用于页眉
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(catalogMeta.project_id) as { name: string } | undefined
    const headerText = project?.name || catalogMeta.title

    const draftLabel = '草稿'
    const dateStr = new Date().toISOString().slice(0, 10)
    const html = generateHtml(manual)
    if (!html) return reply.status(404).send({ error: 'Generate failed' })

    try {
      const puppeteer = await import('puppeteer')

      const launchOpts: LaunchOptions = {
        headless: true,
        args: process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
      }
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
      }

      console.log('Launching browser...')
      const browser = await puppeteer.launch(launchOpts)

      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {})
      // 等待所有图片加载完成（包括外链），超时不阻塞导出
      await page.evaluate(`Array.from(document.images).filter(i=>!i.complete).forEach(i=>{i.onload=i.onerror=()=>{};setTimeout(()=>{},1e4)})`).catch(() => {})
      let pdf = await page.pdf({
        format: 'A4',
        margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2.5cm' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:10px;text-align:center;width:100%;color:#9ca3af;">${headerText}</div>`,
        footerTemplate: `<div style="font-size:10px;text-align:center;width:100%;color:#9ca3af;">${draftLabel} · ${dateStr} · 第 <span class="pageNumber"></span> 页 / <span class="totalPages"></span> 页</div>`,
      })

      await browser.close()

      // 添加 PDF 书签
      try {
        if (manual.headings.length > 0) {
          pdf = await addPdfOutline(Buffer.from(pdf), manual.headings)
        }
      } catch (outlineErr: unknown) {
        console.error('PDF outline failed:', outlineErr instanceof Error ? outlineErr.message : outlineErr)
      }

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(manual.catalog.title)}-${encodeURIComponent(draftLabel)}-${dateStr}.pdf"`)
      return pdf
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('PDF generation failed:', msg)
      reply.header('Content-Type', 'text/html; charset=utf-8')
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(manual.catalog.title)}-${encodeURIComponent(draftLabel)}-${dateStr}.html"`)
      return html.replace('</body>', `<p style="color:red;padding:16px;border:2px solid red;margin:16px;">PDF 生成失败：${msg}</p></body>`)
    }
  })

  // 获取单个 catalog
  app.get('/api/catalogs/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as CatalogRow | undefined
    if (!catalog) return reply.status(404).send({ error: 'Not found' })
    if (!isProjectMember(req.user!.userId, req.user!.role, catalog.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    // 加载 features 详情用于展示
    const entries: CatalogFeatureEntry[] = JSON.parse(catalog.features)
    const featureIds = entries.map(e => e.featureId)
    const features = featureIds.length > 0
      ? db.prepare(`SELECT * FROM features WHERE id IN (${featureIds.map(() => '?').join(',')})`).all(...featureIds) as FeatureRow[]
      : []

    // 按 catalog 中的顺序排列，并应用 sectionOrder
    const featureMap = new Map(features.map(f => [f.id, f]))
    const orderedFeatures = entries.map(e => {
      const f = featureMap.get(e.featureId)
      if (!f) return null
      const sections = JSON.parse(f.sections || '[]') as { key: string; title: string; description?: string }[]
      const ordered = e.sectionOrder
        ? e.sectionOrder.map(k => sections.find(s => s.key === k)).filter(Boolean) as typeof sections
        : sections
      return { ...f, sections: ordered, sectionOrder: e.sectionOrder }
    }).filter(Boolean)

    return {
      ...catalog,
      targets: JSON.parse(catalog.targets),
      coverInfo: JSON.parse(catalog.cover_info),
      features: orderedFeatures,
    }
  })

  // 创建 catalog
  app.post('/api/catalogs', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const body = req.body as CreateCatalogBody
    const projectId = body.projectId || 'default'

    if (!isProjectMember(req.user!.userId, req.user!.role, projectId)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
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

    return { id }
  })

  // 更新 catalog
  app.put('/api/catalogs/:id', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateCatalogBody
    const db = getDb()

    const existing = db.prepare('SELECT id, project_id FROM catalogs WHERE id = ?').get(id) as { id: string; project_id: string } | undefined
    if (!existing) return reply.status(404).send({ error: 'Not found' })

    if (!isProjectMember(req.user!.userId, req.user!.role, existing.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
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

    return { ok: true }
  })

  // 删除 catalog
  app.delete('/api/catalogs/:id', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const catalog = db.prepare('SELECT id, project_id FROM catalogs WHERE id = ?').get(id) as { id: string; project_id: string } | undefined
    if (!catalog) return reply.status(404).send({ error: 'Not found' })

    if (!isProjectMember(req.user!.userId, req.user!.role, catalog.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    db.prepare('DELETE FROM catalogs WHERE id = ?').run(id)
    return { ok: true }
  })
}
