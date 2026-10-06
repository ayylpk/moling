import { createModel } from '../../../create_model'

import { createMemoryStore, type MemoryLayer, type MemoryRecord } from '../db/memoryStore'
import { slugOfNovel } from '../db/connection'
import { createAutomaticPortraitUpdater } from '../service/automaticPortraitService'
import { createNovelL1Extractor } from '../service/l1Extractor'
import { createMemoryAutomation } from '../service/memoryAutomation'
import { createPortraitPipeline } from '../service/portraitService'
import { createSiliconFlowEmbeddingClient } from '../shared/embedding'
import { withNovel } from './withNovel'

/**
 * 记忆与画像 controller —— 一个动作一次调用。
 *
 * 记忆表里的 novel_id 存的是 **slug**（不是数字 id），因为记忆要能跨进程按目录名定位。
 * 所以这一层的每个函数都要把 novelId 换成 slug；调用方只认 novelId。
 *
 * embedding 客户端在这里创建一次就好：它是 HTTP 客户端，构造不花钱，
 * 而每个工具都新建一个会让连接池平白多出几倍。
 */
const embeddingClient = createSiliconFlowEmbeddingClient()

/**
 * 算一段文本的向量；**拿不到就返回 undefined，而不是抛**。
 *
 * 检索本来就分两档：有向量是混合检索，没有就退回关键词匹配。
 * 而 embedding 是外部 HTTP 服务，它挂了不该让"搜一下记忆"整个失败 ——
 * 静默降级只是精度差一点，抛出去则是整条功能不可用。
 */
export const embedOrUndefined = async (input: string): Promise<number[] | undefined> => {
  try {
    return (await embeddingClient.embed([input]))[0]
  } catch (error) {
    console.warn('[memory] embedding 不可用，本次退回关键词检索：', error instanceof Error ? error.message : error)
    return undefined
  }
}

/* ==================== 检索与写入 ==================== */

export const searchNovelMemory = (
  novelId: number,
  query: string,
  options: { layer?: MemoryLayer; volumeId?: number; chapterId?: number; limit?: number; embedding?: number[] } = {},
) =>
  withNovel(novelId, (database) =>
    createMemoryStore(database).search({
      novelId: slugOfNovel(novelId),
      query,
      layer: options.layer,
      volumeId: options.volumeId,
      chapterId: options.chapterId,
      embedding: options.embedding,
      limit: options.limit,
    }),
  )

export const upsertNovelMemory = (novelId: number, record: MemoryRecord) =>
  withNovel(novelId, (database) => createMemoryStore(database).upsert(record))

/* ==================== L1 事实 / L3 画像 ==================== */

/** 记一条 L1 事实（会顺带更新相关角色的画像） */
export const recordNovelFact = (
  novelId: number,
  input: { title: string; content: string; sourceType: string; sourceId: string; characterId?: number; volumeId?: number; chapterId?: number },
) => {
  const slug = slugOfNovel(novelId)
  return withNovel(novelId, async (database) =>
    createPortraitPipeline(database, embeddingClient).recordFact({ ...input, novelId: slug, confidence: 1 }),
  )
}

/** 直接写一版画像 */
export const updateNovelPortrait = (
  novelId: number,
  input: { characterId: number; profile: string; tags: string[]; basedOnFactIds: number[] },
) => {
  const slug = slugOfNovel(novelId)
  return withNovel(novelId, async (database) =>
    createPortraitPipeline(database, embeddingClient).updatePortrait({ ...input, novelId: slug }),
  )
}

/** 捕获一条 L0 事件：落 L0 → 抽 L1 → 更新画像，一条龙 */
export const captureNovelMemoryEvent = (
  novelId: number,
  input: { title: string; content: string; sourceType: string; sourceId: string; characterId?: number; volumeId?: number; chapterId?: number },
) => {
  const slug = slugOfNovel(novelId)
  return withNovel(novelId, (database) => createMemoryAutomation(database, embeddingClient).capture({ novelId: slug, ...input }))
}

/**
 * 捕获一条 L0 事件，并顺手把待处理队列跑到安静。
 *
 * 「捕获」和「处理」是一个动作的两半：只捕获不处理，队列会一直堆在那儿，
 * 事实和画像就迟迟不来。所以它们绑在一起（用 MEMORY_AUTO_L1=false 关掉处理那半）。
 */
export const captureAndSettle = (
  novelId: number,
  input: { title: string; content: string; sourceType: string; sourceId: string; characterId?: number; volumeId?: number; chapterId?: number },
) => {
  const slug = slugOfNovel(novelId)
  return withNovel(novelId, async (database) => {
    const automation = createMemoryAutomation(database, embeddingClient)
    const captured = await automation.capture({ novelId: slug, ...input })
    if (process.env.MEMORY_AUTO_L1 === 'false') return captured

    const extractor = createNovelL1Extractor(createModel(0.1))
    const updatePortrait = createAutomaticPortraitUpdater(createModel(0.1), database, slug, { embed: embeddingClient.embed })
    for (let index = 0; index < 20 && automation.pending() > 0; index += 1) {
      const result = await automation.processNext(extractor, async (_facts, factIds) => {
        await updatePortrait(factIds)
      })
      if (result.status === 'empty' || result.status === 'failed') break
    }
    return captured
  })
}

/**
 * 把一批 L1 事实抽成 L3 画像（手动重跑抽取时用；正常情况下记忆链路自己会做）。
 * 返回被更新了画像的角色 id 列表。
 */
export const refreshCharacterPortraits = (novelId: number, factIds: number[] = []) => {
  const slug = slugOfNovel(novelId)
  return withNovel(novelId, async (database) =>
    createAutomaticPortraitUpdater(createModel(0.1), database, slug, { embed: embeddingClient.embed })(factIds),
  )
}

/** 某个角色的全部画像版本 */
export const listCharacterPortraits = (novelId: number) =>
  withNovel(novelId, (database) => {
    const slug = slugOfNovel(novelId)
    return database
      .query(
        `SELECT p.*, c.name AS character_name FROM character_portraits p
         LEFT JOIN characters c ON c.id = p.character_id
         WHERE p.novel_id = ? AND p.version = (
           SELECT max(p2.version) FROM character_portraits p2 WHERE p2.novel_id = p.novel_id AND p2.character_id = p.character_id
         ) ORDER BY p.character_id`,
      )
      .all(slug)
  })
