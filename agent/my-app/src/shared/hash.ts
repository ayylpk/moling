/**
 * 输入指纹。
 *
 * 用途：generation_tasks.input_hash。开工前对比一下，"这次要跑的输入"和
 * "上次跑完时记下的输入"是不是同一份 —— 一致就复用磁盘产物跳过，不一致就重跑。
 *
 * 为什么必须有这个：光靠"文件存在"判断复用是不安全的。
 * 改了世界观之后，之前那几段大纲缓存照样命中，会安安静静地拿旧输入的结果往下写。
 * 这类错不会报错，只会让产出与设定不符。
 */
import { createHash } from 'node:crypto'

/**
 * 把任意几个值揉成一个短指纹。
 *
 * 分隔符不能省：不加的话 ["ab","c"] 和 ["a","bc"] 会拼成同一个字符串，
 * 撞出同一个 hash，缓存判断就漏了。
 *
 * 长度取 16 个十六进制位（64 bit）：本地缓存判断够用，存库里也不占地方。
 */
export function hashInput(...parts: unknown[]): string {
  const h = createHash('sha256')
  for (const p of parts) {
    h.update(typeof p === 'string' ? p : JSON.stringify(p ?? null))
    h.update('\u0000')
  }
  return h.digest('hex').slice(0, 16)
}
