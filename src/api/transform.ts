// 递归将对象的 snake_case 键转为 camelCase
// 跳过：Date 对象、原始类型

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

export function toCamelCase<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map(toCamelCase) as unknown as T

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const camelKey = snakeToCamel(key)
    result[camelKey] = toCamelCase((value as Record<string, unknown>)[key])
  }
  return result as unknown as T
}
