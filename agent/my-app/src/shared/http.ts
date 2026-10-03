/**
 * controller 层共用的小工具。
 *
 * 原先这三段写在世界观 controller 里，现在有三个 controller 要用同一套，
 * 抄三遍就等着哪天改一处忘两处，所以提出来。
 */
import type { Context } from 'hono'

/** 把 URL 里的 :id 转成数字，不是整数就返回 null */
export const parseId = (raw: string | undefined): number | null =>
  raw && /^\d+$/.test(raw) ? Number(raw) : null

/** service 抛的业务错误统一转 400，别把异常糊成 500 */
export const fail = (c: Context, e: unknown) =>
  c.json({ message: e instanceof Error ? e.message : String(e) }, 400)

/** 读 JSON body，解析失败返回 undefined */
export const readJson = async <T>(c: Context): Promise<T | undefined> => {
  try {
    return (await c.req.json()) as T
  } catch {
    return undefined
  }
}

/**
 * 取挂在 `/api/novels/:novelId/...` 下的小说 id。
 *
 * 所有内容接口的第一个参数都是它 —— novels 是整库的根，
 * 没有 novelId 就没法把查询限定在一本小说里。
 */
export const novelIdOf = (c: Context): number | null => parseId(c.req.param('novelId'))
