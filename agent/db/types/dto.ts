/**
 * DTO —— Data Transfer Object，调用方传进来的数据。
 *
 * 和 Entity 的区别：DTO 里没有 id、created_at、updated_at
 * （这三个是数据库自己生成的，调用方不该填），
 * 而且数组字段在 DTO 里是「真数组」，到写库那一刻才 stringify。
 *
 * 注意：TS 的类型只在编译期存在，运行时传错照样能跑。
 * 要真拦住，得在函数里手写 Array.isArray 检查（见 service 层）。
 */
import type {
  NovelStatus,
  Rule,
  Faction,
  Place,
  Term,
  Stage,
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

/** 新建一本小说 */
export interface CreateNovelDTO {
  /** 人类可读短名 + 磁盘目录名。只允许小写字母、数字、连字符 */
  slug: string
  title: string
  genre?: string
  /** 文风基准。逐章注入，建议建小说时就填 */
  style?: string
  status?: NovelStatus
}

/** 更新：字段全可选，只传要改的那几个 */
export interface UpdateNovelDTO {
  slug?: string
  title?: string
  genre?: string
  style?: string
  status?: NovelStatus
}

export interface NovelQueryDTO {
  status?: NovelStatus
  keyword?: string
}

/* ==================== 世界观 ==================== */

/** 新建一本小说的世界观。不传 version 时由 service 自动取「本小说已有最大版本 + 1」 */
export interface CreateWorldDTO {
  novel_id: number
  name: string
  premise: string
  version?: number
  rules?: Rule[]
  factions?: Faction[]
  places?: Place[]
  terms?: Term[]
  forbidden?: string[]
}

/** 更新：字段全可选，只传要改的那几个，没传的一律不动 */
export interface UpdateWorldDTO {
  name?: string
  premise?: string
  rules?: Rule[]
  factions?: Faction[]
  places?: Place[]
  terms?: Term[]
  forbidden?: string[]
}

/** 查询条件 */
export interface WorldQueryDTO {
  novel_id?: number
  keyword?: string
}

/* ==================== 生成任务（断点续跑） ==================== */

/** 批量登记待办：不存在才插，已存在的不动 */
export interface PlanTasksDTO {
  stage: Stage
  target_keys: string[]
  /** 登记时就已知的输入指纹，可省略（claim 时再补） */
  input_hash?: string
}

/**
 * 领一个任务。返回值告诉调用方该跑还是该跳。
 *
 * 这是整套续跑的判断点：
 *   done 且 hash 一致 → 跳过（复用磁盘产物）
 *   其余情况          → 跑，并把状态置 running、attempt + 1
 */
export interface ClaimTaskDTO {
  stage: Stage
  target_key: string
  /** 本次输入的指纹。为空表示不参与缓存判断，一律重跑 */
  input_hash?: string
}

/** 任务跑完 */
export interface FinishTaskDTO {
  /** 磁盘产物的相对路径 */
  artifact_path?: string
}

/** 任务失败 */
export interface FailTaskDTO {
  error: string
}

/** 任务查询条件 */
export interface TaskQueryDTO {
  stage?: Stage
  status?: string
}

/** 失效传播：上游一变，本阶段及下游全部作废 */
export interface InvalidateDTO {
  /** 从这个阶段开始往下作废 */
  from_stage: Stage
}

/* ==================== 角色 ==================== */

/**
 * 建一张角色卡。
 *
 * `relations` 里写的是**名字**，不是 id —— agent 本来就只能写出名字。
 * 落库时由 service 查表解析成 id，解析不到的留 NULL（不报错，因为
 * 那个人可能真的还没建）。想显式表达"这里需要一个新人"，名字写成
 * `NEW:戏剧功能`，它永远不会被解析，会一直留在待建清单里。
 */
export interface CreateCharacterDTO {
  novel_id: number
  name: string
  role: CharacterRole
  immutable?: string[]
  voice?: string
  want?: string
  cost?: string
  need?: string
  secret?: string
  reveal?: string
  line?: string
  flaw?: string
  arc?: { start: string; end: string }
  status?: CharacterStatus
  /** 不传按 agent 算（产物）；手写的主角传 hand */
  source?: CharacterSource
  relations?: { raw: string; attitude: string }[]
}

export interface UpdateCharacterDTO {
  name?: string
  role?: CharacterRole
  immutable?: string[]
  voice?: string
  want?: string
  cost?: string
  need?: string
  secret?: string
  reveal?: string
  line?: string
  flaw?: string
  arc?: { start: string; end: string }
  status?: CharacterStatus
  source?: CharacterSource
}

export interface CharacterQueryDTO {
  role?: CharacterRole
  status?: CharacterStatus
  /** 只看关系里指向了不存在角色的那些卡 */
  unresolvedOnly?: boolean
}

/* ==================== 地点 ==================== */

export interface CreateLocationDTO {
  novel_id: number
  name: string
  /** 上级地点的名字。世界观只给了粗骨架，这里写名字，由 service 解析成 id */
  parent?: string
  signature: string
  features?: string[]
  role?: string
}

export interface UpdateLocationDTO {
  name?: string
  parent?: string
  signature?: string
  features?: string[]
  role?: string
}

/* ==================== 卷 ==================== */

export interface CreateVolumeDTO {
  novel_id: number
  no: number
  name: string
  goal: string
  from_state: string
  to_state: string
  start_chapter: number
  end_chapter: number
}

export interface UpdateVolumeDTO {
  name?: string
  goal?: string
  from_state?: string
  to_state?: string
  start_chapter?: number
  end_chapter?: number
}

/* ==================== 大纲 ==================== */

export interface CreateAnchorDTO {
  novel_id: number
  logline: string
  theme: string
  core_conflict: string
  ending_direction: string
  structure_type: string
  main_plot: Plotline
  subplots?: Plotline[]
  /** 哪一卷定的稿。第一卷传 1 */
  locked_by_volume?: number
}

/**
 * 保存一卷大纲。这一个 DTO 会落到 5 张表：
 * volumes / outline_volumes / chapters / chapter_cast / generation_tasks。
 * service 里必须包事务 —— 只写进去一半的库比彻底失败更难查。
 */
export interface SaveVolumeOutlineDTO {
  novel_id: number
  volume: CreateVolumeDTO
  /** 本卷的结构 / 节奏 / 约束 */
  outline: {
    structure_type: string
    acts: Act[]
    turning_points: TurningPoint[]
    pacing: PacingPlan
    constraints: OutlineConstraintsData
  }
  /** 本卷回填的锚点，和已有锚点逐字比对，不一致就是漂移 */
  anchor: Omit<CreateAnchorDTO, 'novel_id' | 'locked_by_volume'>
  chapters: CreateChapterDTO[]
}

/* ==================== 章节 ==================== */

export interface CreateChapterDTO {
  /** 全篇连续的章号，不从 1 重开 */
  idx: number
  title: string
  goal: string
  conflict: string
  hook: string
  emotion: string
  summary: string
  /** 已有地名，或 `NEW:戏剧功能` */
  place: string
  characters: string[]
  word_count_target?: number
}

export interface UpdateChapterDTO {
  title?: string
  goal?: string
  conflict?: string
  hook?: string
  emotion?: string
  summary?: string
  place?: string
  characters?: string[]
  word_count_target?: number
}

export interface ChapterQueryDTO {
  volume_id?: number
  /** 章号区间，闭区间 */
  from?: number
  to?: number
  /** 只看正文到哪个阶段的（outlined = 还没正文） */
  textStage?: TextStage
}

/* ==================== 正文 ==================== */

export interface SaveChapterTextDTO {
  stage: TextStage
  text: string
  /** writer 写的本章概要，写回前情用 */
  summary?: string
  ends_with?: string
  /** polisher 的改动清单 */
  polish_report?: unknown
}

/* ==================== 角色裁决 ==================== */

export interface SaveActorDecisionDTO {
  chapter_id: number
  /** 用名字，service 解析成 id。解析不到留 NULL */
  character: string
  situation: string
  options: ActorOptions
  choice: ActorChoiceValue
  custom_answer?: string
  reason: string
  line: string
  prompt_hash: string
}
