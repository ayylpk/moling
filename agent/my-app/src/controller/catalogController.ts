import { assertDimensionMatches, GENRE_DIR, STYLE_DIR } from '../../../skills'
import { listNovelsInCatalog, type CatalogNovel } from '../db/connection'
import { createNovelInCatalog, getNovelInCatalog, type NovelCreateInput } from '../service/catalogService'

/**
 * 书架 controller —— 目录库的动作。
 *
 * 它是唯一一个不接 novelId 的 controller，因为它管的是"还没成为一本小说的东西"。
 */
export const listNovels = (): CatalogNovel[] => listNovelsInCatalog()

export const getNovel = (novelId: number): CatalogNovel | null => getNovelInCatalog(novelId)

export const createNovel = (input: NovelCreateInput): CatalogNovel => createNovelInCatalog(input)

/**
 * 建书前校验：文风与类型有没有写错。
 *
 * **只提示，不拒绝** —— 作者写"90年代港风"是合法的创作决定，硬拦下来是替他做主。
 * 返回的只是"你是不是想写这个"，由调用方决定是当提示显示还是忽略。
 *
 * 为什么值得单独给一个动作：拼错目录名（比如「冷俊克制」）的后果不是报错，
 * 而是**这本书从头到尾没有文风** —— 而作者看不出任何异常。
 * 在建书那一刻说一声，是唯一能让人还改得动的时机。
 */
export const checkFlavorNames = (input: { style?: string; genre?: string }) => ({
  style: assertDimensionMatches(STYLE_DIR, input.style),
  genre: assertDimensionMatches(GENRE_DIR, input.genre),
})
