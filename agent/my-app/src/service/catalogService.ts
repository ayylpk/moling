import { openCatalogDatabase, openNovelDatabase, type CatalogNovel } from '../db/connection'

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