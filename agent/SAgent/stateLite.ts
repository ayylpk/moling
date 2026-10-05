import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import { openCatalogDatabase, openNovelDatabase } from '../storage/novelDatabase'

export type Phase = 'init' | 'world' | 'cast' | 'outline' | 'prose' | 'polish' | 'done'
export const PHASE_ORDER: Phase[] = ['init', 'world', 'cast', 'outline', 'prose', 'polish', 'done']

export const NovelState = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  novelId: Annotation<number | null>,
  slug: Annotation<string | null>,
  title: Annotation<string | null>,
  genre: Annotation<string | null>,
  style: Annotation<string | null>,
  phase: Annotation<Phase>,
  currentVolumeNo: Annotation<number>,
  currentChapterIdx: Annotation<number>,
  worldId: Annotation<number | null>,
  worldVersion: Annotation<number | null>,
  characterIds: Annotation<number[]>,
  locationIds: Annotation<number[]>,
  volumeIds: Annotation<number[]>,
  draftedChapterIdxs: Annotation<number[]>,
  finalizedChapterIdxs: Annotation<number[]>,
  pendingDemands: Annotation<string[]>,
  completedTaskKeys: Annotation<string[]>,
})

export type NovelStateValue = {
  novelId: number | null
  slug: string | null
  /** 书名 / 题材 / 文风 —— 从 catalog 现取，随状态快照注入（"读小说元数据"这一步因此不必单独调工具） */
  title: string | null
  genre: string | null
  style: string | null
  phase: Phase
  currentVolumeNo: number
  currentChapterIdx: number
  worldId: number | null
  worldVersion: number | null
  characterIds: number[]
  locationIds: number[]
  volumeIds: number[]
  draftedChapterIdxs: number[]
  finalizedChapterIdxs: number[]
  pendingDemands: string[]
  completedTaskKeys: string[]
}

/**
 * 状态种子：还没接上小说时的空壳。
 *
 * `agent/system.ts` 的 `seed` 就是它 + 真实的 novelId/slug —— invoke 时带上，
 * `novelStateSync` 才有推导状态的入口（拿不到 id 就整轮跳过，见下方中间件）。
 *
 * 一开始长在旧的 `state.ts` 里，迁到 stateLite 时漏了带着走，
 * 结果 system.ts 的 import 解析不到、`bun agent/run.ts` 直接起不来。
 */
export const INITIAL_NOVEL_STATE: NovelStateValue = {
  novelId: null,
  slug: null,
  title: null,
  genre: null,
  style: null,
  phase: 'init',
  currentVolumeNo: 1,
  currentChapterIdx: 1,
  worldId: null,
  worldVersion: null,
  characterIds: [],
  locationIds: [],
  volumeIds: [],
  draftedChapterIdxs: [],
  finalizedChapterIdxs: [],
  pendingDemands: [],
  completedTaskKeys: [],
}

export const deriveNovelState = (novelId: number): Omit<NovelStateValue, 'novelId' | 'slug'> => {
  const catalog = openCatalogDatabase()
  // 书名 / 题材 / 文风顺路取回来：createSAgent 的"读小说元数据"这一步就靠它，
  // 不然中心 Agent 连自己在写哪本书都要额外开一次连接
  const novel = catalog.query('SELECT slug, title, genre, style FROM novels WHERE id = ?').get(novelId) as
    | { slug: string; title: string; genre: string; style: string }
    | null
  catalog.close()
  if (!novel) throw new Error(`小说不存在：novelId=${novelId}`)
  const database = openNovelDatabase(novel.slug)
  try {
    const world = database.query('SELECT id, version FROM worlds ORDER BY version DESC LIMIT 1').get() as { id: number; version: number } | null
    const characters = database.query('SELECT id FROM characters ORDER BY id').all() as Array<{ id: number }>
    const locations = database.query('SELECT id FROM locations ORDER BY id').all() as Array<{ id: number }>
    const volumes = database.query('SELECT id FROM volumes ORDER BY no').all() as Array<{ id: number }>
    const drafted = database.query("SELECT c.idx FROM chapters c JOIN chapter_texts t ON t.chapter_id = c.id WHERE t.stage = 'draft' ORDER BY c.idx").all() as Array<{ idx: number }>
    const finalized = database.query("SELECT c.idx FROM chapters c JOIN chapter_texts t ON t.chapter_id = c.id WHERE t.stage = 'final' ORDER BY c.idx").all() as Array<{ idx: number }>
    const chapters = database.query('SELECT idx FROM chapters ORDER BY idx').all() as Array<{ idx: number }>
    const tasks = database.query("SELECT stage, target_key FROM generation_tasks WHERE status = 'done'").all() as Array<{ stage: string; target_key: string }>
    const phase: Phase = world === null ? 'init' : volumes.length === 0 ? 'world' : chapters.length === 0 ? 'outline' : finalized.length > 0 ? 'polish' : 'prose'
    const written = finalized.length > 0 ? finalized : drafted
    return {
      title: novel.title,
      genre: novel.genre,
      style: novel.style,
      phase,
      currentVolumeNo: volumes.length || 1,
      currentChapterIdx: (written.at(-1)?.idx ?? 0) + 1,
      worldId: world?.id ?? null,
      worldVersion: world?.version ?? null,
      characterIds: characters.map((item) => item.id),
      locationIds: locations.map((item) => item.id),
      volumeIds: volumes.map((item) => item.id),
      draftedChapterIdxs: drafted.map((item) => item.idx),
      finalizedChapterIdxs: finalized.map((item) => item.idx),
      pendingDemands: [],
      completedTaskKeys: tasks.map((item) => `${item.stage}:${item.target_key}`),
    }
  } finally { database.close() }
}

export function renderStateBlock(state: Partial<NovelStateValue>): string {
  const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
  return [
    '=== 当前状态（交给你的工具都基于它；每轮刷新）===',
    `书目：《${state.title ?? '（未知）'}》｜题材：${state.genre || '未填'}｜文风：${state.style || '未填'}`,
    `阶段：${state.phase ?? '未知'}`,
    `进度：第 ${state.currentVolumeNo ?? 1} 卷｜下一章写第 ${state.currentChapterIdx ?? 1} 章`,
    `世界观：${state.worldId ? `id=${state.worldId} version=${state.worldVersion}` : '未建立'}`,
    `场上：角色 ${list(state.characterIds).length} 个｜地点 ${list(state.locationIds).length} 个｜卷 ${list(state.volumeIds).length} 卷`,
    `已写：起草 ${list(state.draftedChapterIdxs).length} 章｜定稿 ${list(state.finalizedChapterIdxs).length} 章`,
    '=== 状态结束 ===',
  ].join('\n')
}

export function novelStateSync() {
  return {
    name: 'NovelStateSync',
    beforeModel: (state: { novelId?: number | null }) => typeof state.novelId === 'number' ? deriveNovelState(state.novelId) : undefined,
    wrapModelCall: async (request: any, handler: any) => {
      const novelId = request.state?.novelId
      if (typeof novelId !== 'number') return handler(request)
      return handler({ ...request, systemPrompt: `${request.systemPrompt ?? ''}\n\n${renderStateBlock({ ...request.state, ...deriveNovelState(novelId) })}` })
    },
  }
}
