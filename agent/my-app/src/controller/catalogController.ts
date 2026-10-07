import { assertDimensionMatches, GENRE_DIR, STYLE_DIR } from '../../../skills'
import { listNovelsInCatalog, type CatalogNovel } from '../db/connection'
import {
  createNovelInCatalog,
  getNovelInCatalog,
  removeNovelFromCatalog,
  updateNovelFlavorsInCatalog,
  type NovelCreateInput,
  type NovelFlavorInput,
  type NovelRemoval,
} from '../service/catalogService'

/**
 * 书架 controller —— 目录库的动作。
 *
 * 它是唯一一个不接 novelId 的 controller，因为它管的是"还没成为一本小说的东西"。
 */
export const listNovels = (): CatalogNovel[] => listNovelsInCatalog()

export const getNovel = (novelId: number): CatalogNovel | null => getNovelInCatalog(novelId)

export const createNovel = (input: NovelCreateInput): CatalogNovel => createNovelInCatalog(input)

/**
 * 改已建好那本书的题材与文风。
 *
 * 用 PUT 而不是 PATCH，是因为它和本仓库其它更新接口（角色、世界观）同一个口径：
 * **给了的字段覆盖，没给的保持原样**。CORS 白名单里也已经允许 PUT。
 */
export const updateNovelFlavors = (novelId: number, input: NovelFlavorInput): CatalogNovel =>
  updateNovelFlavorsInCatalog(novelId, input)

/**
 * 从书架移除一本书。
 *
 * **书稿文件不会真删**（挪进 `.workbuddy/novel-trash/`），但目录库那一行会删掉，
 * 所以恢复要两步 —— 详见 `catalogService.removeNovelFromCatalog`。
 */
export const removeNovel = (novelId: number): NovelRemoval => removeNovelFromCatalog(novelId)

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
