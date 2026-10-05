import type { Database } from 'bun:sqlite'
import type { RunnableConfig } from '@langchain/core/runnables'

import { captureNovelEvent } from '../../storage/autoCapture'
import type { L0Event } from '../../storage/portraitPipeline'
import { openCatalogDatabase, openNovelDatabase } from '../../storage/novelDatabase'

/**
 * 工具的公共上下文 —— 「从 novelId 走到 per-novel 库」这一段只写一次。
 *
 * 十个 runtime 工具走的都是同一条路：
 *   config.configurable.novelId → catalog.sqlite 查 slug → 开 resources/novels/<slug>/novel.sqlite
 *   → 调 runtime → 关库
 * 把它抽出来，是为了让「打开的是哪个库」这件事**只有一个答案**。散在各工具里写，
 * 迟早有一个漏掉改成 myapp.sqlite（那正是这次要收掉的老毛病）。
 *
 * ── 中心 Agent 不允许直接操作 SQL ──
 * 所以这一层只暴露 `withNovelDatabase`（把它当作用域用），工具里出现 SQL 就是走错了。
 * runtime 才是唯一懂列名的地方。
 */

/** 取当前小说。没有 novelId 就直接失败 —— 不要猜、不要回落到"第一本" */
export const novelOf = (config?: RunnableConfig): { id: number; slug: string } => {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('缺少小说上下文：调用中心 Agent 时请在 config 里传 `configurable: { novelId }`。')
  }
  const catalog = openCatalogDatabase()
  try {
    const novel = catalog.query('SELECT slug FROM novels WHERE id = ?').get(id) as { slug: string } | null
    if (!novel) throw new Error(`小说不存在：novelId=${id}`)
    return { id, slug: novel.slug }
  } finally {
    catalog.close()
  }
}

/** 打开这本小说的库、执行 action、无论成败都关掉它 */
export const withNovelDatabase = <T>(
  config: RunnableConfig | undefined,
  action: (database: Database, novel: { id: number; slug: string }) => T,
): T => {
  const novel = novelOf(config)
  const database = openNovelDatabase(novel.slug)
  try {
    return action(database, novel)
  } finally {
    database.close()
  }
}

/** 工具的返回格式：一顶label + 内容。工具结果最终会进中心上下文，别塞全文 */
export const pack = (label: string, value: unknown): string =>
  `【${label}】\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`

/**
 * 落库之后的自动记忆。
 *
 * **失败绝不影响业务**：记忆链路里挂着 embedding 与模型调用，它挂了不该把刚提交的
 * 角色/大纲/裁决一起回滚（那会让"存成功"变成一句谎话）。所以这里不 await、不抛，
 * 出什么错都咽下去 —— 记忆是锦上添花，不是业务的一部分。
 */
export const rememberNovelEvent = (novelId: number, event: Omit<L0Event, 'novelId'>): void => {
  void captureNovelEvent(novelId, event).catch(() => undefined)
}
