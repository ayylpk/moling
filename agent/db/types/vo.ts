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
  CharacterRole,
  CharacterStatus,
  CharacterSource,
  TextStage,
  ActorChoiceValue,
  Plotline,
  Act,
  TurningPoint,
  PacingPlan,
  OutlineConstraintsData,
  ActorOptions,
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

/* ==================== 角色 ==================== */

/** 关系网的一条，已解析的形态。`character_id` 为空 = 那个人还没建 */
export interface CharacterRelationVO {
  id: number
  from_character_id: number
  to_raw: string
  to_character_id: number | null
  attitude: string
  resolved_at: string | null
}

/** 一张角色卡，完整数据（含解析好的关系网） */
export interface CharacterVO {
  id: number
  novel_id: number
  name: string
  role: CharacterRole
  immutable: string[]
  voice: string
  want: string
  cost: string
  need: string
  secret: string
  reveal: string
  line: string
  flaw: string
  arc: { start: string; end: string }
  status: CharacterStatus
  source: CharacterSource
  relations: CharacterRelationVO[]
  created_at: string
  updated_at: string
}

/**
 * 列表用的精简版。
 *
 * 不拉 voice / want / secret 那些长文本 —— 列角色时几乎只用得上
 * 「他是谁、什么定位、活着没有、关系里还有没有没兑现的」。
 */
export interface CharacterBriefVO {
  id: number
  novel_id: number
  name: string
  role: CharacterRole
  status: CharacterStatus
  source: CharacterSource
  /** 关系网里指向了不存在角色的条数。大于 0 说明这张卡还没接完 */
  unresolvedRelations: number
}

/* ==================== 地点 ==================== */

export interface LocationVO {
  id: number
  novel_id: number
  name: string
  parent_raw: string
  parent_id: number | null
  parent_name: string | null
  signature: string
  features: string[]
  role: string
  created_at: string
  updated_at: string
}

/** 层级树的一个节点，给前端画地图用 */
export interface LocationTreeNodeVO {
  id: number
  name: string
  signature: string
  parent_id: number | null
  children: LocationTreeNodeVO[]
}

/* ==================== 卷与大纲 ==================== */

export interface VolumeVO {
  id: number
  novel_id: number
  no: number
  name: string
  goal: string
  from_state: string
  to_state: string
  start_chapter: number
  end_chapter: number
  /** 这一卷的大纲建了没有。从 outline_volumes 推出来的，不是存的 */
  hasOutline: boolean
  created_at: string
  updated_at: string
}

export interface OutlineAnchorVO {
  novel_id: number
  logline: string
  theme: string
  core_conflict: string
  ending_direction: string
  structure_type: string
  main_plot: Plotline
  subplots: Plotline[]
  locked_by_volume: number | null
  locked_at: string
}

/**
 * 锚点快照：本卷生成时回填的那份锚点。
 *
 * 和 outline_anchors 逐字比一下就是漂移检查。单独定义而不是复用
 * OutlineAnchorVO，因为它不含 novel_id / locked_at 这些跟"回到哪一卷"无关的字段。
 */
export interface AnchorSnapshot {
  logline: string
  theme: string
  core_conflict: string
  ending_direction: string
  structure_type: string
  main_plot: Plotline
  subplots: Plotline[]
}

export interface OutlineVolumeVO {
  id: number
  novel_id: number
  volume_id: number
  structure_type: string
  acts: Act[]
  turning_points: TurningPoint[]
  pacing: PacingPlan
  constraints: OutlineConstraintsData
  anchor_snapshot: AnchorSnapshot
  created_at: string
  updated_at: string
  /**
   * 锚点漂移检查：本卷回填的锚点与当前 outline_anchors 是否逐字一致。
   * 不一致就是缺陷，不是"编辑"。
   */
  anchorDrift: boolean
}

/* ==================== 章节 ==================== */

export interface ChapterVO {
  id: number
  novel_id: number
  volume_id: number
  idx: number
  title: string
  goal: string
  conflict: string
  hook: string
  emotion: string
  summary: string
  place_raw: string
  place_id: number | null
  place_name: string | null
  characters: { raw: string; character_id: number | null }[]
  word_count_target: number
  /** 正文到哪一步了：none / draft / final */
  textStage: 'none' | 'draft' | 'final'
  /** 正文字数。用 length(text) 现算，不存副本 */
  wordCount: number
  created_at: string
  updated_at: string
}

/** 列表用：不带正文，但带字数与阶段 */
export interface ChapterBriefVO {
  id: number
  idx: number
  title: string
  volume_id: number
  textStage: 'none' | 'draft' | 'final'
  wordCount: number
}

/**
 * 还没兑现的需求。
 *
 * 章纲里写了 `NEW:一个在第三章泄露内情的线人`，但那个角色还没建 ——
 * 这张表就是中心 agent 的待办清单。
 */
export interface PendingDemandVO {
  kind: 'character' | 'location'
  chapter_id: number
  chapter_idx: number
  raw: string
  /** NEW: 后面的那段话，正好是 Character / Location agent 的 {NEED} */
  need: string
}

/* ==================== 正文 ==================== */

export interface ChapterTextVO {
  id: number
  novel_id: number
  chapter_id: number
  stage: TextStage
  text: string
  summary: string
  ends_with: string
  polish_report: unknown
  /** 现算，不存 */
  wordCount: number
  created_at: string
  updated_at: string
}

/* ==================== 角色裁决 ==================== */

export interface ActorDecisionVO {
  id: number
  novel_id: number
  chapter_id: number
  character_id: number | null
  character_name: string | null
  situation: string
  options: ActorOptions
  choice: ActorChoiceValue
  custom_answer: string
  reason: string
  line: string
  prompt_hash: string
  created_at: string
}
