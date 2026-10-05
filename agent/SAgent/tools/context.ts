import type { Database } from 'bun:sqlite'
import type { RunnableConfig } from '@langchain/core/runnables'

import { openCatalogDatabase, openNovelDatabase } from '../../storage/novelDatabase'
import { createWorldRuntime } from '../worldRuntime'

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
export const novelOf = (config?: RunnableConfig): { id: number; slug: string; title: string; genre: string; style: string } => {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('缺少小说上下文：调用中心 Agent 时请在 config 里传 `configurable: { novelId }`。')
  }
  const catalog = openCatalogDatabase()
  try {
    const novel = catalog.query('SELECT slug, title, genre, style FROM novels WHERE id = ?').get(id) as
      | { slug: string; title: string; genre: string; style: string }
      | null
    if (!novel) throw new Error(`小说不存在：novelId=${id}`)
    return { id, slug: novel.slug, title: novel.title, genre: novel.genre, style: novel.style }
  } finally {
    catalog.close()
  }
}

/** 一本书在目录里的身份：id + slug + 写作时要用的元数据（style 会逐章注入） */
export type NovelRef = ReturnType<typeof novelOf>

/** 打开这本小说的库、执行 action、无论成败都关掉它 */
export const withNovelDatabase = <T>(
  config: RunnableConfig | undefined,
  action: (database: Database, novel: NovelRef) => T,
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
 * 落库之后的自动记忆 —— 实现在 `storage/novelEffects.ts`，那里是**工具层与 HTTP 层的共同出口**。
 * 这里只做转出：工具原先就从 './context' 拿它，不必为了搬家改一堆 import。
 *
 * 记忆**失败绝不影响业务**：链路里挂着 embedding 与模型调用，它挂了不该把刚提交的
 * 角色/大纲/裁决一起回滚（那会让「存成功」变成一句谎话）。
 */
export { rememberNovelEvent } from '../../storage/novelEffects'

/**
 * 把 per-novel 库里的世界观渲染成**子 agent 看得懂的紧凑文本**。
 *
 * 三个生成工具（角色 / 地点 / 大纲）都要喂这一段，所以渲染格式只在这里定义一次 ——
 * 两处各写一遍的话，迟早有一处的 rules 渲染漏掉「代价」，而"没有代价的规则就是外挂"
 * 正是这套世界观设计的核心约束，漏掉等于把硬约束放空。
 *
 * 注意喂的是**硬约束**（rules 的三件套 / forbidden / terms），不是 JSON 结构：
 * 子 agent 的提示词就是照这个形状写的（见 buildCharacterPrompt 等）。
 * 库里没有世界观就直接抛 —— 不要让子 agent 在真空里编一套规则出来。
 */
export const renderWorld = (database: Database): string => {
  const world = createWorldRuntime(database).current()
  if (!world) {
    throw new Error('这本小说还没有世界观。先用 save_world 把世界观落库 —— 角色/地点/大纲都以它为硬约束。')
  }
  const rules = (world.rules ?? []).map((rule, index) => `${index + 1}. ${rule.ability}｜代价：${rule.cost}｜界线：${rule.limit}`)
  const names = (list: unknown[] | undefined): string[] =>
    (list ?? []).map((item) => (item && typeof item === 'object' ? String((item as { name?: unknown }).name ?? '') : '')).filter(Boolean)
  const factions = names(world.factions)
  const places = names(world.places)
  const terms = (world.terms ?? []).map((term) => term.name).filter(Boolean)
  return [
    `premise: ${world.premise}`,
    'rules:',
    ...(rules.length ? rules : ['  （无）']),
    `factions: ${factions.length ? factions.join(' / ') : '（无）'}`,
    `places: ${places.length ? places.join(' / ') : '（无）'}`,
    `terms: ${terms.length ? terms.join(' / ') : '（无）'}`,
    'forbidden:',
    ...((world.forbidden ?? []).length ? (world.forbidden ?? []).map((item) => `- ${item}`) : ['- （无）']),
  ].join('\n')
}
