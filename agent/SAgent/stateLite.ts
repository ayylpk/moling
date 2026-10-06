import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import { catalog, state as stateApi } from '../my-app'

/**
 * 阶段判据住在 my-app 的 shared/ 里（后端的 /workflow 也要用它）。
 * 这里原样转出，SAgent 内部与外部的引用都不用改。
 */
import { phaseOf, PHASE_ORDER, type Phase } from '../my-app/src/shared/phase'

export { phaseOf, PHASE_ORDER, type Phase }

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
  // 读库全交给 my-app：这里既不知道 slug 怎么解析，也不知道"阶段"是怎么判的
  // （那两条 SQL 与 phaseOf 都在门面后面，与 /workflow 用的是同一份判据）。
  const novel = catalog.getNovel(novelId)
  if (!novel) throw new Error(`小说不存在：novelId=${novelId}`)
  const snapshot = stateApi.getNovelStateSnapshot(novelId)
  return {
    // 书名 / 题材 / 文风顺路带上：中心 Agent 的"读小说元数据"这一步就靠它，
    // 不然它连自己在写哪本书都要多问一次
    title: novel.title,
    genre: novel.genre,
    style: novel.style,
    phase: snapshot.phase,
    currentVolumeNo: snapshot.currentVolumeNo,
    currentChapterIdx: snapshot.currentChapterIdx,
    worldId: snapshot.worldId,
    worldVersion: snapshot.worldVersion,
    characterIds: snapshot.characterIds,
    locationIds: snapshot.locationIds,
    volumeIds: snapshot.volumeIds,
    draftedChapterIdxs: snapshot.draftedChapterIdxs,
    finalizedChapterIdxs: snapshot.finalizedChapterIdxs,
    pendingDemands: [],
    completedTaskKeys: snapshot.completedTaskKeys,
  }
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
