import { listNovelsInCatalog, type CatalogNovel } from '../db/connection'
import { createNovelInCatalog, getNovelInCatalog, type NovelCreateInput } from '../service/catalogService'

/**
 * 书架 controller —— 目录库的三个动作。
 *
 * 它是唯一一个不接 novelId 的 controller，因为它管的是"还没成为一本小说的东西"。
 */
export const listNovels = (): CatalogNovel[] => listNovelsInCatalog()

export const getNovel = (novelId: number): CatalogNovel | null => getNovelInCatalog(novelId)

export const createNovel = (input: NovelCreateInput): CatalogNovel => createNovelInCatalog(input)