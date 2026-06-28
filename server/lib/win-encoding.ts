/**
 * Windows 终端 UTF-8 编码修复
 *
 * Windows 终端（cmd/PowerShell/VS Code 内置终端）默认使用 GBK (CP936) 解码，
 * 而 Node.js 输出的是 UTF-8。这会导致中文日志显示为乱码。
 *
 * 此模块在 server 启动最早期调用 chcp 65001，将终端代码页切换为 UTF-8。
 *
 * 导入位置：必须是每个入口文件中最早的 import 之一。
 */
if (process.platform === 'win32') {
  const { execSync } = await import('node:child_process')
  try {
    execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // chcp 不可用时静默失败（例如在 mintty 终端中可能不需要）
  }
}
