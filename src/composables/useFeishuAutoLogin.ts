// 飞书客户端环境检测 + 状态常量
// JSAPI 相关代码已移除，仅保留 UA 检测

/** 通过 User-Agent 判断是否在飞书/Lark 客户端内 */
export function isFeishuClient(): boolean {
  const ua = navigator.userAgent
  return /Feishu|Lark/i.test(ua)
}
