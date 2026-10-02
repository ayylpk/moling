/**
 * 统一的时间格式。
 *
 * 生成和 SQLite datetime('now','localtime') 完全同格式的字符串：2026-09-28 18:12:11
 *
 * 为什么不用现成的：new Date().toISOString() 出来是 UTC 的 ISO 格式
 * （2026-09-28T10:12:11.000Z），跟库里已有的字符串格式对不上 ——
 * 混着存的话，字符串排序和比较全是错的。
 *
 * 格式要统一，就统一成 SQLite 这一套。
 */
export const now = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}
