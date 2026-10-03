/**
 * Entity —— 与数据库表一一对应的一层。
 *
 * 规则：字段类型 = 数据在 SQLite 里的真实形态。
 * rules / factions / places / terms / forbidden 在库里存的是 JSON 文本，
 * 所以这里就是 string，不是数组。解析成数组是 VO 那一层的事。
 *
 * 这一层不要加业务字段，也不要为了方便改类型 —— 加了就会和表结构对不上。
 */

/* ==================== 共享子结构（打包进 JSON 列的那些） ==================== */

/** 规则。顺序有意义：数组第 1 条是根规则，后面从它派生 */
export interface Rule {
  id: string
  text: string
}

export interface Faction {
  id: string
  name: string
  desc?: string
}

export interface Place {
  id: string
  name: string
  desc?: string
}

/** 专名表：润色 agent 的「不许改」清单 */
export interface Term {
  term: string
  forbidden?: string
  note?: string
}

/* ==================== 枚举（同时约束表上的 CHECK） ==================== */

export const NOVEL_STATUS = ['draft', 'writing', 'paused', 'done'] as const
export type NovelStatus = (typeof NOVEL_STATUS)[number]

/**
 * 流水线阶段。顺序有意义 —— `STAGE_ORDER` 用来做失效传播：
 * 上游一变，下游全部作废。
 *
 * character 与 location 是同一级的兄弟（都由大纲触发），所以并列。
 */
export const STAGE_ORDER = [
  'world',
  'character',
  'location',
  'outline',
  'chapter',
  'polish',
] as const
export type Stage = (typeof STAGE_ORDER)[number]

export const TASK_STATUS = ['pending', 'running', 'done', 'failed', 'stale'] as const
export type TaskStatus = (typeof TASK_STATUS)[number]

/* ==================== novels 表的一行 ==================== */

/** 一本小说。全库的根，其余所有表都挂在它下面 */
export interface NovelEntity {
  id: number
  /** 人类可读的短名，同时当磁盘目录名用（resources/runs/<slug>/），必须是文件系统安全字符 */
  slug: string
  title: string
  /** 题材。agent 本身不绑题材，这里只做归档与检索 */
  genre: string
  /** 文风基准。逐章注入，必须持久 */
  style: string
  status: NovelStatus
  created_at: string
  updated_at: string
}

/* ==================== worlds 表的一行 ==================== */

/** worlds 表的一行 */
export interface WorldEntity {
  id: number
  novel_id: number
  /**
   * 版本号，同一本小说内从 1 递增。
   *
   * 为什么要版本：世界观是最上游的约束，它一改下游（大纲/章节/正文）全部失效。
   * 留版本才能回答「这一卷是基于哪一版世界观生成的」，
   * 也才能把「输入变了要重跑」变成 generation_tasks.input_hash 可比对的事实。
   */
  version: number
  name: string
  premise: string
  rules: string
  factions: string
  places: string
  terms: string
  forbidden: string
  created_at: string
  updated_at: string
}

/* ==================== generation_tasks 表的一行 ==================== */

/**
 * 一个可续跑的工作单元。
 *
 * 这张表是「分阶段产出」的骨架：开工前先按 (novel_id, stage, target_key) 查一眼，
 * 就知道该跳过还是该跑。
 */
export interface GenerationTaskEntity {
  id: number
  novel_id: number
  stage: Stage
  /**
   * 对象标识，字符串。约定：
   *   world     → "v1"
   *   character → "林晚"
   *   location  → "天台"
   *   outline   → "vol:1"（合并后）/"vol:1:seg:2"（分段中间态）
   *   chapter   → "ch:013"
   *   polish    → "ch:013"
   */
  target_key: string
  status: TaskStatus
  /** 已尝试次数。每次 claim 都 +1，用来发现"反复失败的那个点" */
  attempt: number
  /** 输入的指纹。为空表示不参与缓存判断，每次都要跑 */
  input_hash: string
  /** 磁盘上原始产物的相对路径（相对 resources/runs/<slug>/）。库只存指针，不存内容 */
  artifact_path: string
  error: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

/* ==================== 内容层：共享子结构（打包进 JSON 列） ==================== */

export const CHARACTER_ROLE = ['protagonist', 'antagonist', 'support'] as const
export type CharacterRole = (typeof CHARACTER_ROLE)[number]

export const CHARACTER_STATUS = ['alive', 'dead', 'disabled'] as const
export type CharacterStatus = (typeof CHARACTER_STATUS)[number]

/**
 * 这张卡是谁写的。
 *
 * `hand` 是给男女主留的：主角是整条流水线的输入、不是产物，
 * Character agent 被明令禁止建主角。不记这一笔的话，事后没法分辨
 * "这张卡是模型编的"还是"人定的"，而这两者的可信度完全不同。
 */
export const CHARACTER_SOURCE = ['agent', 'hand'] as const
export type CharacterSource = (typeof CHARACTER_SOURCE)[number]

/** 正文的两个阶段。初稿留着是为了审计润色到底改了些什么 */
export const TEXT_STAGE = ['draft', 'final'] as const
export type TextStage = (typeof TEXT_STAGE)[number]

export const ACTOR_CHOICE = ['A', 'B', 'C', 'D'] as const
export type ActorChoiceValue = (typeof ACTOR_CHOICE)[number]

/** 故事线。主线与支线共用这一个形状，靠 type 区分 */
export interface Plotline {
  id: string
  name: string
  type: 'main' | 'sub'
  goal: string
  conflict: string
  resolution: string
  involvedCharacters: string[]
}

export interface Act {
  id: string
  name: string
  goal: string
  summary: string
  startChapter: number
  endChapter: number
  keyEvents: string[]
}

export interface TurningPoint {
  id: string
  type: 'inciting' | 'plot-point-1' | 'midpoint' | 'plot-point-2' | 'climax' | 'resolution'
  chapter: number
  description: string
  impact: string
}

export interface TensionPoint {
  chapter: number
  intensity: number
}

export interface PacingPlan {
  tensionCurve: TensionPoint[]
  climaxChapters: number[]
  restChapters: number[]
  hookDensity: number
}

export interface OutlineConstraintsData {
  timeline: string
  locations: string[]
  rules: string[]
  forbidden: string[]
}

/** Actor 那一场给出的三个具体选项与 D 的题面 */
export interface ActorOptions {
  A: string
  B: string
  C: string
  chatPrompt: string
}

/* ==================== characters ==================== */

/**
 * 一张角色卡。
 *
 * 与 agent 的 CharacterSchema 一一对应，只有三处结构性差异：
 *   · `immutable` 在库里是 JSON 文本
 *   · `arc` 拆成 arc_start / arc_end 两列 —— 「起点 ≠ 终点」是判定这张卡
 *     有没有推进的判据，埋进 JSON 就没法用 SQL 比
 *   · `relations` 不在这里，拆到 character_relations 表，为了用外键拦现编 id
 */
export interface CharacterEntity {
  id: number
  novel_id: number
  name: string
  role: CharacterRole
  immutable: string
  voice: string
  want: string
  cost: string
  need: string
  secret: string
  reveal: string
  line: string
  flaw: string
  arc_start: string
  arc_end: string
  status: CharacterStatus
  source: CharacterSource
  created_at: string
  updated_at: string
}

/**
 * 关系网的一条边。
 *
 * `to_raw` 是卡上原样写的那个名字，`to_character_id` 是查表解析出来的 id。
 * 解析不到就是 NULL —— 这不丢信息，反而正是**待建清单**：
 *   SELECT * FROM character_relations WHERE to_character_id IS NULL
 * 一眼就知道还有谁没建。
 */
export interface CharacterRelationEntity {
  id: number
  novel_id: number
  from_character_id: number
  to_raw: string
  to_character_id: number | null
  attitude: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

/* ==================== locations ==================== */

/**
 * 一个地点卡。
 *
 * `parent_id` 是自引用外键：**子地点不可能挂在不存在的地点之下**。
 * 这正是最初那套「层级挂载」的物理保证 —— 世界观只铺粗骨架（青州），
 * 细粒度地点（旧观那口枯井）由剧情生长，但必须挂得上去。
 */
export interface LocationEntity {
  id: number
  novel_id: number
  name: string
  parent_raw: string
  parent_id: number | null
  signature: string
  features: string
  role: string
  created_at: string
  updated_at: string
}

/* ==================== volumes ==================== */

/**
 * 一卷。
 *
 * `from_state` / `to_state` 是本卷主角的起点与终点状态，两者必须不同 ——
 * 这就是「这一卷到底有没有推进」的判据。
 *
 * 存 `start/end_chapter` 而不是从 chapters 推：第二卷还没生成章节时，
 * 卷表仍要能表达"第 51–100 章"，这不可推导。
 *
 * 这里**没有 status 列**：这一卷到哪一步了，从 outline_volumes 存不存在、
 * 它的章节有没有 final 正文就能推出来。存一份副本只会和事实不同步。
 */
export interface VolumeEntity {
  id: number
  novel_id: number
  no: number
  name: string
  goal: string
  from_state: string
  to_state: string
  start_chapter: number
  end_chapter: number
  created_at: string
  updated_at: string
}

/* ==================== outline_anchors / outline_volumes ==================== */

/**
 * 全篇锚点。一本小说一行，由第一卷定稿，之后每卷原样回填。
 *
 * 为什么从卷里拆出来单独成表：锚点回填的检查**就是逐字比对**。
 * 埋进每卷的 JSON 里，SQL 比不了，只能把两卷都拉回内存再 JSON.stringify。
 * 拆成列之后，一条查询就能看出第 3 卷有没有把 logline 改了。
 */
export interface OutlineAnchorEntity {
  novel_id: number
  logline: string
  theme: string
  core_conflict: string
  ending_direction: string
  structure_type: string
  main_plot: string
  subplots: string
  locked_by_volume: number | null
  locked_at: string
}

/** 一卷的大纲。acts / turningPoints / 节奏 / 约束都是本卷视角 */
export interface OutlineVolumeEntity {
  id: number
  novel_id: number
  volume_id: number
  structure_type: string
  acts: string
  turning_points: string
  pacing: string
  constraints: string
  /**
   * 本卷回填的锚点副本。
   * 和 outline_anchors 逐字比一下就是漂移检查（不一致说明这卷把锚点改了）。
   */
  anchor_snapshot: string
  created_at: string
  updated_at: string
}

/* ==================== chapters ==================== */

/**
 * 一条章纲。
 *
 * `idx` 是全篇连续的章号，`UNIQUE(novel_id, idx)` —— **第二卷从 1 重开编号会直接插入失败**。
 * 「编号全篇连续」这条约定不靠人记，靠约束。
 *
 * `place_raw` 原样存（可能是 "NEW:一个能撞见仇人的地方"），`place_id` 是解析结果。
 * 同样**没有 status 列**：这一章到哪一步，看 chapter_texts 里有没有 draft / final。
 */
export interface ChapterEntity {
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
  word_count_target: number
  created_at: string
  updated_at: string
}

/**
 * 章 → 角色。
 *
 * 这张表是整层的枢纽：可空的 `character_id` 让「这一章需要谁」和
 * 「这个角色建了没」变成同一行记录的两种状态。
 *
 *   WHERE character_id IS NULL AND raw LIKE 'NEW:%'   → 待建清单
 */
export interface ChapterCastEntity {
  id: number
  novel_id: number
  chapter_id: number
  raw: string
  character_id: number | null
  resolved_at: string | null
  created_at: string
}

/**
 * 章节正文。
 *
 * 一章最多两行：draft（writer 初稿）和 final（polisher 终稿），
 * `UNIQUE(chapter_id, stage)`。重跑就 UPSERT 覆盖，不堆历史版本 ——
 * 要历史的去看磁盘 runs 目录，库里只留"现在是什么"。
 *
 * **不存 word_count**：SQLite 的 length(text) 对 UTF-8 恰好就是中文字数，
 * 存一份副本只会和事实不同步。
 */
export interface ChapterTextEntity {
  id: number
  novel_id: number
  chapter_id: number
  stage: TextStage
  text: string
  summary: string
  ends_with: string
  polish_report: string
  created_at: string
  updated_at: string
}

/* ==================== actor_decisions ==================== */

/**
 * 一次角色裁决的记录。
 *
 * 存它的三个理由：
 *   1. writer 的 {DECISIONS} 要读它
 *   2. 重跑这一章时不必重问（prompt_hash 一致就直接复用）—— 省调用
 *   3. 可审计：事后能看出这个角色当时为什么这么选
 */
export interface ActorDecisionEntity {
  id: number
  novel_id: number
  chapter_id: number
  character_id: number | null
  situation: string
  options: string
  choice: ActorChoiceValue
  custom_answer: string
  reason: string
  line: string
  /** 这一次问的输入指纹。一致就不必重问 */
  prompt_hash: string
  created_at: string
}
