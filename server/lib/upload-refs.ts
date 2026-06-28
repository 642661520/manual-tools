// ============================================================
// 上传文件引用工具
// 从 HTML / Y.js BLOB 中提取 uploads 文件引用路径
// ============================================================

/** 绝对路径 uploads 引用: /uploads/images/ab/fullhash.ext */
const UPLOAD_ABS_RE = /\/uploads\/(images|videos)\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-zA-Z]+/g

/** 相对路径 uploads 引用: ../../uploads/images/[shard/]filename.ext */
const UPLOAD_REL_RE = /\.\.\/\.\.\/uploads\/(images|videos)\/([a-f0-9]{2}\/)?([^"'\s>]+)/g

/**
 * 从 HTML 文本中提取 /uploads/ 文件引用路径（绝对路径）
 * 返回去除了 /uploads/ 前缀的相对路径，如 "images/ab/hash.png"
 */
export function extractUploadRefsFromHtml(html: string): string[] {
  const matches = html.matchAll(UPLOAD_ABS_RE)
  return [...new Set([...matches].map((m) => m[0].replace(/^\/uploads\//, '')))]
}

/**
 * 从 Y.js BLOB 中提取 uploads 文件引用
 * （Y.js 二进制编码后仍包含原始 HTML 文本，直接扫描即可）
 */
export function extractUploadRefsFromBlob(blob: Buffer): string[] {
  return extractUploadRefsFromHtml(blob.toString('utf-8'))
}

/**
 * 将 HTML 中的绝对路径 uploads 引用转换为相对路径（导出用）
 * /uploads/images/ab/hash.png → ../../uploads/images/ab/hash.png
 */
export function absoluteToRelativeUploadPaths(html: string): string {
  return html.replace(UPLOAD_ABS_RE, (m) => '../../' + m.replace(/^\//, ''))
}

/**
 * 将 HTML 中的相对路径 uploads 引用转换为绝对路径（导入用）
 * ../../uploads/images/ab/hash.png → /uploads/images/ab/hash.png
 */
export function relativeToAbsoluteUploadPaths(html: string): string {
  return html.replace(UPLOAD_REL_RE, (_, type, shard, rest) => {
    return `/uploads/${type}/${shard || ''}${rest}`
  })
}

/**
 * 从相对路径中解析出 ZIP 内的实际文件路径和文件名信息
 * 输入: "../../uploads/images/ab/fullhash.png" 或 "../../uploads/images/myfile.png"
 * 返回: { zipPath: "uploads/images/ab/fullhash.png", filename: "fullhash.png", isHashed: true }
 */
export function parseRelativeUploadRef(
  relPath: string,
): { zipPath: string; filename: string; isHashed: boolean } | null {
  const match = relPath.match(
    /^(?:\.\.\/)*uploads\/(images|videos)\/((?:[a-f0-9]{2}\/)?)([^"'\s>]+)$/,
  )
  if (!match) return null
  const zipPath = `uploads/${match[1]}/${match[2]}${match[3]}`
  const filename = match[3]
  // 64 位 hex 文件名 = 已哈希
  const isHashed = /^[a-f0-9]{64}\.[a-zA-Z]+$/.test(filename)
  return { zipPath, filename, isHashed }
}
