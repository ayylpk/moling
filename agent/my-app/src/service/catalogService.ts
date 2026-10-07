import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { novelDirectory, openCatalogDatabase, openNovelDatabase, type CatalogNovel } from '../db/connection'

/**
 * 目录库（书架）service。
 *
 * 目录级元数据不属于任何一本书，所以这里既没有 novelId 也没有 per-novel 库。
 * 建书这件事之所以算 service 而不是路由里的十几行：
 *
 * **建一本书要做三件事，而它们必须一起成功或一起不做** ——
 * 往目录库插一行、在 resources/novels/<slug>/ 建库并建表、回读那一行。
 * 只插行不建库，前端立刻能看到一本书、点进去什么都没有；只建库不插行，
 * 目录里看不见，等于白建。校验也在这一层，因为"slug 合不合法"问的是数据，
 * 不是 HTTP。
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/

/**
 * themes 在目录库里是 **JSON 字符串**（表上有 CHECK(json_valid)），
 * 但接口允许前端直接给数组。两种形态都要收下：前端知道它是 JSON 字符串吗？
 * 不一定，而为了一个字段要求每个调用方都先 stringify 一次，是把存储细节漏出去。
 */
const normalizeThemes = (input: string[] | string | undefined): string => {
  if (input === undefined) return '[]'
  if (Array.isArray(input)) {
    if (!input.every((theme) => typeof theme === 'string')) throw new TypeError('themes 必须是字符串数组')
    return JSON.stringify(input)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new TypeError('themes 必须是合法 JSON 数组')
  }
  if (!Array.isArray(parsed) || !parsed.every((theme) => typeof theme === 'string')) throw new TypeError('themes 必须是字符串数组')
  return JSON.stringify(parsed)
}

export type NovelCreateInput = {
  slug?: string
  title?: string
  genre?: string
  style?: string
  description?: string
  logline?: string
  target_words?: number
  themes?: string[] | string
  status?: string
}

export const createNovelInCatalog = (input: NovelCreateInput): CatalogNovel => {
  if (!input.slug || !SLUG_PATTERN.test(input.slug)) throw new TypeError('slug 必须是小写字母、数字或连字符')
  if (!input.title) throw new TypeError('title 不能为空')

  const targetWords = input.target_words ?? 0
  if (!Number.isInteger(targetWords) || targetWords < 0) throw new TypeError('target_words 必须是非负整数')
  const themes = normalizeThemes(input.themes)

  const catalog = openCatalogDatabase()
  try {
    catalog.query(
      `INSERT INTO novels (slug, title, genre, style, description, logline, target_words, themes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.slug,
      input.title,
      input.genre ?? '',
      input.style ?? '',
      input.description ?? '',
      input.logline ?? '',
      targetWords,
      themes,
      input.status ?? 'draft',
    )
    const created = catalog.query('SELECT * FROM novels WHERE slug = ?').get(input.slug) as CatalogNovel | null
    if (!created) throw new Error('建书后读不回刚写入的那一行')

    // 库和表现在就建出来：让"书存在但点进去是空的"这件事在写入时就暴露，
    // 而不是等作者建完世界观才发现少了一层
    openNovelDatabase(created.slug).close()
    return created
  } finally {
    catalog.close()
  }
}

export const getNovelInCatalog = (novelId: number): CatalogNovel | null => {
  const catalog = openCatalogDatabase()
  try {
    return catalog.query('SELECT * FROM novels WHERE id = ?').get(novelId) as CatalogNovel | null
  } finally {
    catalog.close()
  }
}

export type NovelFlavorInput = {
  genre?: string
  style?: string
}

/**
 * 改一本**已经建好**的书的题材与文风。
 *
 * 为什么值得单独做一个动作：建书那一刻是一次性的，作者往往先建了空书、后来才想清楚
 * 这是悬疑还是现实。在这之前他只能把书删了重建（登记会没），或者忍着。
 *
 * ── 只动目录库那一行，不动 books 自己的库 ──
 * `genre` / `style` **全项目只有 catalog.novels 这一处存**，生成时才被读出来拼进提示词
 * （见各 agent 的 `composePrompt(..., flavor.style, flavor.genre, ...)`）。
 * 所以改完立刻对**往后**的生成生效，不需要动任何一本别人的库。
 *
 * ── 已有正文不会被改写 ──
 * 片段是在生成/润色那一刻注入的，已经落盘的章节不受影响。
 * 想让旧章也换风格，得重新生成 —— 这一点前端必须说清楚，不然作者会以为改了个开关。
 */
/**
 * 改题材与文风的**纯 SQL 部分**。
 *
 * 单独抽出来是为了能用 `:memory:` 直接打 —— 与 `portraitService` 的
 * `createPortraitPipeline(database, ...)` 同一个套路。外面那层只负责开库关库，
 * 所以校验和"只覆盖给了的字段"这两条真正容易写错的逻辑，能被测试钉住。
 */
export const applyNovelFlavors = (database: Database, novelId: number, input: NovelFlavorInput): CatalogNovel => {
  const genre = input.genre === undefined ? undefined : String(input.genre).trim()
  const style = input.style === undefined ? undefined : String(input.style).trim()
  if (genre === undefined && style === undefined) throw new TypeError('至少要给 genre 或 style 中的一个')
  if (genre !== undefined && genre.length > 64) throw new TypeError('genre 太长了（上限 64 字）')
  if (style !== undefined && style.length > 200) throw new TypeError('style 太长了（上限 200 字）')

  const row = database.query('SELECT * FROM novels WHERE id = ?').get(novelId) as CatalogNovel | null
  if (!row) throw new Error(`小说不存在：novelId=${novelId}`)

  // 只覆盖给了的那个字段 —— 没给的一边保持原样，不是清空
  database.query("UPDATE novels SET genre = ?, style = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(genre ?? row.genre, style ?? row.style, novelId)

  const updated = database.query('SELECT * FROM novels WHERE id = ?').get(novelId) as CatalogNovel | null
  if (!updated) throw new Error('改完读不回那一行')
  return updated
}

export const updateNovelFlavorsInCatalog = (novelId: number, input: NovelFlavorInput): CatalogNovel => {
  const catalog = openCatalogDatabase()
  try {
    return applyNovelFlavors(catalog, novelId, input)
  } finally {
    catalog.close()
  }
}

/** 被移除的书稿去哪了。与 `skills/manage.ts` 的题材隔离区同一个思路：可逆，且不进 git */
const TRASH_ROOT = path.join(import.meta.dir, '../../../../.workbuddy/novel-trash')

export type NovelRemoval = {
  id: number
  slug: string
  title: string
  /** 书稿目录挪到了哪里。目录本来就不存在时是空串 */
  movedTo: string
}

/**
 * 从书架移除一本书。
 *
 * ── 为什么先挪目录，再删登记 ──
 * 两件事必须"看起来一起发生"，但文件系统那一步不能回滚。所以顺序是：
 * **先挪目录**（可逆、且失败时什么都没变），**再删目录库那一行**；
 * 万一删行失败，就把目录挪回去 —— 否则会留下"登记没了、文件也没了"那种最坏的结果。
 *
 * ── 为什么不能只说"可以恢复" ──
 * 目录库那一行是**真删**的（书架就是照它渲染的，留着一行不显示没有意义）。
 * 所以恢复要两步：把目录搬回 `resources/novels/<slug>/`，再重新建一本同 slug 的书。
 * 返回体里给了 `movedTo`，前端要把这两步如实告诉用户。
 */
export const removeNovelFromCatalog = (novelId: number): NovelRemoval => {
  const catalog = openCatalogDatabase()
  try {
    const row = catalog.query('SELECT id, slug, title FROM novels WHERE id = ?').get(novelId) as { id: number; slug: string; title: string } | null
    if (!row) throw new Error(`小说不存在：novelId=${novelId}`)

    const source = novelDirectory(row.slug)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const movedTo = path.join(TRASH_ROOT, stamp, row.slug)

    // 目录可能压根没建过（建了书但从没打开过库），那就没有可挪的东西
    const moved = fs.existsSync(source)
    if (moved) {
      fs.mkdirSync(path.dirname(movedTo), { recursive: true })
      fs.renameSync(source, movedTo)
    }

    try {
      catalog.query('DELETE FROM novels WHERE id = ?').run(novelId)
    } catch (error) {
      if (moved) fs.renameSync(movedTo, source) // 补偿：把目录搬回去，别留下半截状态
      throw error
    }

    return { id: row.id, slug: row.slug, title: row.title, movedTo: moved ? movedTo : '' }
  } finally {
    catalog.close()
  }
}