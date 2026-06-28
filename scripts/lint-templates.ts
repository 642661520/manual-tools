/**
 * 检查 .vue 文件中模板的 JavaScript 表达式语法错误。
 *
 * vue-eslint-parser 不对指令值做完整的 JS 语法校验，
 * 此脚本使用 Vue 官方编译器 compileTemplate() 来捕获 @click 等内联表达式中的语法错误。
 */
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { parse, compileTemplate, errorMessages } from 'vue/compiler-sfc'

const SRC_DIR = join(import.meta.dirname, '..', 'src')

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry)
    const s = await stat(p)
    if (s.isDirectory() && entry !== 'node_modules' && entry !== 'dist') {
      yield* walk(p)
    } else if (extname(entry) === '.vue') {
      yield p
    }
  }
}

interface CompileError {
  code: number
  loc: {
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
    source: string
  }
}

let totalErrors = 0
const filesWithErrors: string[] = []

for await (const file of walk(SRC_DIR)) {
  const source = readFileSync(file, 'utf-8')
  const { descriptor, errors: parseErrors } = parse(source, { filename: file })

  // SFC 解析错误
  for (const err of parseErrors) {
    totalErrors++
    const rel = relative(process.cwd(), file)
    console.error(
      `${rel}:${err.loc?.start.line ?? 1}:${err.loc?.start.column ?? 1}  ${err.message}`,
    )
  }

  // 模板编译检查
  if (descriptor.template) {
    const { errors: compileErrors } = compileTemplate({
      source: descriptor.template.content,
      filename: file,
      id: file,
    })

    for (const err of compileErrors as CompileError[]) {
      totalErrors++
      const rel = relative(process.cwd(), file)
      const line = err.loc.start.line
      const col = err.loc.start.column
      const msg = errorMessages[err.code] ?? `Unknown error (code=${err.code})`
      console.error(`${rel}:${line}:${col}  ${msg}`)
      if (!filesWithErrors.includes(rel)) filesWithErrors.push(rel)
    }
  }
}

if (totalErrors > 0) {
  console.error(`\n✖ ${totalErrors} template error(s) in ${filesWithErrors.length} file(s)`)
  process.exit(1)
}

console.log('✓ All templates passed')
process.exit(0)
