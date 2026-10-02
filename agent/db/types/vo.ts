/**
 * VO —— View Object，返回出去给调用方看的数据。
 *
 * 和 Entity 的区别：JSON 文本已经解析成真数组，用起来可以直接 .map / .length，
 * 不用每处都写一遍 JSON.parse。
 */
import type {
  Rule,
  Faction,
  Place,
  Term,
  NovelStatus,
  Stage,
  TaskStatus,
  GenerationTaskEntity,
} from './entity'

/* ==================== 小说 ==================== */

/** 单本小说的完整数据 */
export interface NovelVO {
  id: number
  slug: string
  title: string
  genre: string
  style: string
  status: NovelStatus
  created_at: string
  updated_at: string
}

/* ==================== 世界观 ==================== */

/** 单个世界观的完整数据 */
export interface WorldVO {
  id: number
  novel_id: number
  version: number
  name: string
  premise: string
  rules: Rule[]
  factions: Faction[]
  places: Place[]
  terms: Term[]
  forbidden: string[]
  created_at: string
  updated_at: string
}

/** 列表用的精简版：不带几个大数组，只给个数量 */
export interface WorldBriefVO {
  id: number
  novel_id: number
  version: number
  name: string
  premise: string
  ruleCount: number
}

/* ==================== 生成任务 ==================== */

/** 任务表没有 JSON 列，Entity 就是 VO，这里留个名字让调用方不必依赖 entity */
export type GenerationTaskVO = GenerationTaskEntity

/** 一个阶段的完成情况 */
export interface StageProgressVO {
  stage: Stage
  total: number
  done: number
  failed: number
  stale: number
  running: number
  pending: number
}

/** 一本小说的整体进度。`next` 是「下一步该干什么」——未完成任务的第一个 */
export interface GenerationProgressVO {
  novel_id: number
  total: number
  done: number
  byStage: StageProgressVO[]
  /** 还没跑完的对象标识，按阶段顺序 + 登记顺序排 */
  remaining: { stage: Stage; target_key: string; status: TaskStatus }[]
}

/** claim 的结果 */
export interface ClaimTaskVO {
  /** run = 该跑；skip = 输入没变，复用磁盘产物 */
  action: 'run' | 'skip'
  reason: string
  task: GenerationTaskVO
}
