/** 校验密码强度（3/4 规则：大写、小写、数字、特殊字符中至少满足3种） */
export function validatePassword(password: unknown): string | null {
  if (!password || typeof password !== 'string') {
    return '请输入密码'
  }
  if (password.length < 8) {
    return '密码不能少于8位'
  }
  if (password.length > 128) {
    return '密码不能超过128位'
  }

  let categories = 0
  if (/[A-Z]/.test(password)) categories++
  if (/[a-z]/.test(password)) categories++
  if (/[0-9]/.test(password)) categories++
  if (/[^A-Za-z0-9]/.test(password)) categories++

  if (categories < 3) {
    return '密码需包含大写字母、小写字母、数字、特殊字符中至少3种'
  }

  return null
}
