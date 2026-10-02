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
import type { NovelStatus, Rule, Faction, Place, Term, Stage } from './entity'

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
