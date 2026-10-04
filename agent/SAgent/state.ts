/**
 * SAgent 的状态。
 *
 * ── 一个必须先讲清的分工 ──
 * **业务真相源永远是数据库**（13 张表 + generation_tasks）。
 * 这里的状态是「**指针与快照**」：当前在写哪本、走到哪个阶段、写到第几卷第几章、
 * 场上已有哪些实体（id 与版本号）、哪些章有稿哪些定稿、还欠什么。
 *
 * 为什么不把设定/大纲/正文也搬进来：那会让已有的 `input_hash` 幂等、断点续跑、
 * 锚点漂移检查全部失效——那些机制都建立在"库是唯一真相"之上。
 *
 * ── 状态怎么保持正确 ──
 * 不靠"每个工具记得回写"（一定会漏），而是**每次调模型前从库里推导一遍**
 * （见 novelStateSync）。SQLite 本地查询开销可以忽略，换来的是状态永远与库一致。
 * 这是刻意的选择：宁可多查一次，也不要一份会飘的状态。
 */
import { Annotation, MessagesAnnotation } from "@langchain/langgraph"

import { getNovel } from "../my-app/src/service/novelService"
import { getCurrentWorld } from "../my-app/src/service/storyPlannerService"
import { listCharacters } from "../my-app/src/service/characterService"
import { listLocations } from "../my-app/src/service/locationService"
import { listVolumeOutlines } from "../my-app/src/service/outlineService"
import { listChapters, listPendingDemands } from "../my-app/src/service/chapterService"
import { listTasks } from "../my-app/src/service/taskService"

/* ==================== 阶段 ==================== */

/**
 * 创作阶段。它是一条**顺序链**，不是标记位——顺序由 SAgent 的 skill 约束。
 *
 *   init   还没立项
 *   world  世界观（整条链的起点）
 *   cast   角色与地点
 *   outline 卷大纲
 *   prose  正文
 *   polish 润色
 *   done   完稿
 */
export type Phase = "init" | "world" | "cast" | "outline" | "prose" | "polish" | "done"

/** 推导阶段的顺序，用来做"只进不退"的判断 */
export const PHASE_ORDER: Phase[] = ["init", "world", "cast", "outline", "prose", "polish", "done"]

/* ==================== 状态定义 ==================== */

/**
 * 小说创作的状态。
 *
 * 按「一本小说从立项到成书，一路上必须记得的东西」定，一样不省。
 * 这些字段全部可以由库推导出来（见 deriveNovelState）——它们是**缓存**，
 * 不是第二份真相。
 */
export const NovelState = Annotation.Root({
  /** 对话历史。SAgent 的记忆就是它，由 checkpointer 负责持久化。 */
  messages: MessagesAnnotation.spec.messages,

  /* ---- 这条路在写哪本书 ---- */
  novelId: Annotation<number | null>,
  slug: Annotation<string | null>,

  /* ---- 走到哪了 ---- */
  phase: Annotation<Phase>,
  /** 当前处理到第几卷（1 起） */
  currentVolumeNo: Annotation<number>,
  /** 当前处理到第几章（全篇连续编号，1 起） */
  currentChapterIdx: Annotation<number>,

  /* ---- 场上已有什么（真身在库里）---- */
  /** 当前生效的世界观 id 与版本号。改世界观 = 新建一版，版本号递增 */
  worldId: Annotation<number | null>,
  worldVersion: Annotation<number | null>,
  characterIds: Annotation<number[]>,
  locationIds: Annotation<number[]>,
  volumeIds: Annotation<number[]>,

  /* ---- 章的进度 ---- */
  /** 已有初稿的章号 */
  draftedChapterIdxs: Annotation<number[]>,
  /** 已定稿（润色完）的章号 */
  finalizedChapterIdxs: Annotation<number[]>,

  /* ---- 还欠什么 ---- */
  /** 章纲里声明了 `NEW:xxx` 但还不存在的角色/地点。非空时应该先去补 */
  pendingDemands: Annotation<string[]>,

  /* ---- 断点续跑 ---- */
  /** 本轮已完成的任务键（`stage:target_key`），用来避免重复跑 */
  completedTaskKeys: Annotation<string[]>,
})

/** 首次进入时的初值。novelId / slug 由调用方在 invoke 时传入覆盖。 */
export const INITIAL_NOVEL_STATE: NovelStateValue = {
  novelId: null,
  slug: null,
  phase: "init" as Phase,
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

/* ==================== 从库推导 ==================== */

/**
 * 从库里能推导出来的那部分状态。
 *
 * 显式写出来而不是 `typeof INITIAL_NOVEL_STATE`——字面量的类型会被收窄
 * （`worldId: null` 推成 `null`、`characterIds: []` 推成 `never[]`），
 * 那样赋值时会一片报错。
 */
export interface DerivedNovelState {
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
  /**
   * 已完成的任务键（`stage:target_key`）。
   *
   * 它是 `generation_tasks` 的**投影**，不是一份独立状态——
   * 从库里现推，所以永远准。有了它，中心 agent 在 claim 之前
   * 就能看出哪几步已经跑完，不必逐个去领。
   */
  completedTaskKeys: string[]
}

/** 进 graph 的完整状态值：可推导的那部分 + 会话自身的标识。 */
export interface NovelStateValue extends DerivedNovelState {
  novelId: number | null
  slug: string | null
}

/**
 * 把状态从数据库重新推导一遍。
 *
 * 这是状态的**唯一写入途径**——没有任何工具手工回写状态，
 * 所以不存在"某个工具忘了同步"导致的漂移。
 */
export function deriveNovelState(novelId: number): DerivedNovelState {
  const novel = getNovel(novelId)
  const world = getCurrentWorld(novelId)
  const chars = listCharacters(novelId)
  const places = listLocations(novelId)
  const volumes = listVolumeOutlines(novelId)
  const chapters = listChapters(novelId)
  const demands = listPendingDemands(novelId)

  const drafted = chapters.filter((c) => c.textStage === "draft").map((c) => c.idx).sort((a, b) => a - b)
  const finalized = chapters.filter((c) => c.textStage === "final").map((c) => c.idx).sort((a, b) => a - b)

  /* ---- 阶段：按"缺什么"往后推，不按"有什么"往前猜 ---- */
  let phase: Phase = "init"
  if (world) {
    phase = "world"
    if (chars.length > 0 || places.length > 0) {
      phase = "cast"
      if (volumes.length > 0) {
        phase = "outline"
        if (drafted.length > 0) {
          phase = "prose"
          // 所有章都有终稿才算润色完；没有章时不算
          if (chapters.length > 0 && finalized.length >= chapters.length) phase = "polish"
        }
      }
    }
  }
  // 全部章都定稿后又没有待办，就是完稿
  if (phase === "polish" && demands.length === 0) phase = "done"

  /* ---- 当前进度指针 ---- */
  const written = finalized.length > 0 ? finalized : drafted
  const lastWritten = written.length > 0 ? written[written.length - 1]! : 0
  const maxChapter = chapters.length > 0 ? Math.max(...chapters.map((c) => c.idx)) : 0
  // 有稿就接着下一章；没稿就从第一章开始
  const currentChapterIdx = Math.max(lastWritten + 1, 1)

  const currentVolumeNo = volumes.length > 0 ? volumes.length : 1

  return {
    phase,
    currentVolumeNo,
    currentChapterIdx,
    worldId: world?.id ?? null,
    worldVersion: world?.version ?? null,
    characterIds: chars.map((c) => c.id),
    locationIds: places.map((p) => p.id),
    volumeIds: volumes.map((v) => v.id),
    draftedChapterIdxs: drafted,
    finalizedChapterIdxs: finalized,
    pendingDemands: demands.map((d) => (typeof d === "string" ? d : JSON.stringify(d))),
    // 已完成的任务键：从任务表现推（它是库的投影，不是独立状态）
    completedTaskKeys: listTasks(novelId)
      .filter((t) => t.status === "done")
      .map((t) => `${t.stage}:${t.target_key}`),
  }
}

/* ==================== 状态同步中间件 ==================== */

/**
 * 把当前状态渲染成**给模型看的**一段文本。
 *
 * 这段文本会被注入每一轮调用的 systemPrompt（见下面 novelStateSync 的 wrapModelCall）。
 * 写法上刻意"短、可扫、每行一个事实"——它是**状态**，不是解释；
 * 需要解释的规则在 prompt.ts / skill 里，两者分工不要混。
 */
export function renderStateBlock(state: Partial<NovelStateValue>): string {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const drafted = arr(state.draftedChapterIdxs)
  const finalized = arr(state.finalizedChapterIdxs)
  const demands = arr(state.pendingDemands)

  return [
    "=== 当前状态（交给你的工具都基于它；每轮刷新，不要凭记忆猜进度）===",
    `阶段：${state.phase ?? "未知"}`,
    `进度：第 ${state.currentVolumeNo ?? 1} 卷｜下一章写第 ${state.currentChapterIdx ?? 1} 章`,
    `世界观：${state.worldId ? `id=${state.worldId} version=${state.worldVersion}` : "未建立"}`,
    `场上：角色 ${arr(state.characterIds).length} 个｜地点 ${arr(state.locationIds).length} 个｜卷 ${arr(state.volumeIds).length} 卷`,
    `已写：起草 ${drafted.length} 章｜定稿 ${finalized.length} 章` +
      (drafted.length > 0 ? `（有稿的章号：${drafted.join("、")}）` : ""),
    `待办需求：${demands.length > 0 ? demands.join(" / ") : "无"}`,
    "=== 状态结束 ===",
  ].join("\n")
}

/**
 * 状态同步中间件——把状态**喂给模型**。
 *
 * 它做两件事，缺一不可。之前只做了第一件，结果状态躺在 graph 里、模型看不见，
 * 等于没做——中心 agent 只能靠第一条 user message 里那份过期的快照判断进度。
 *
 *   ① `beforeModel`：把状态刷成库里的实际情况（推导，见 deriveNovelState）
 *   ② `wrapModelCall`：把这份状态拼进**这一次调用的 systemPrompt**
 *
 * 为什么放在 `beforeModel` / `wrapModelCall` 而不是工具里：
 *   · 工具回写一定会漏（新增一个工具就多一处要记得写）
 *   · 这两个钩子每轮必经，且此时还没产生新的 tool 结果，
 *     状态与库必然一致——不存在"读到一半的中间态"
 *
 * 拿不到 novelId 时**直接跳过**（不猜、不用默认值）：
 * 让状态停在原处，比拿一个错的 id 去查错库安全。
 */
export function novelStateSync() {
  return {
    name: "NovelStateSync",

    /** ① 推导：把状态刷成库里的实际情况 */
    beforeModel: (state: { novelId?: number | null }) => {
      const novelId = state.novelId
      if (typeof novelId !== "number" || !Number.isInteger(novelId)) return undefined
      try {
        return deriveNovelState(novelId)
      } catch {
        // 推导失败（比如库还没建表）不该让整个 agent 停摆，保持上一版状态即可
        return undefined
      }
    },

    /**
     * ② 注入：把状态拼进这次调用的 systemPrompt。
     *
     * 用 `wrapModelCall` 而不是官方的 `dynamicSystemPromptMiddleware`：
     * 前者能拿到**完整的 graph state**（含 novelId），后者只给 `AgentBuiltInState`（基本只有 messages）。
     * 拿不到 novelId 就得从 runtime.context 绕，多一层配置，不划算。
     *
     * 请求/处理的类型这里显式写成 `any`：这两个类型（ModelRequest /
     * WrapModelCallHandler）在 langchain 里没有对外导出，硬去深链会把我们
     * 绑在它的目录结构上。结构本身是稳的
     * （{ model, messages, systemPrompt, tools, state, runtime } → handler(request)），
     * 所以按结构写；代价是这一处没有类型检查，改动时请对着上面那行结构核对。
     */
    wrapModelCall: async (request: any, handler: any) => {
      const base: string = request.systemPrompt ?? ""
      const state: Partial<NovelStateValue> | undefined = request.state
      const novelId = state?.novelId
      // 没定位到小说就不注入：宁可让模型看到静态提示词，也不要喂一段空状态骗它
      if (typeof novelId !== "number" || !Number.isInteger(novelId)) {
        return handler(request)
      }
      return handler({ ...request, systemPrompt: `${base}\n\n${renderStateBlock(state ?? {})}` })
    },
  }
}
