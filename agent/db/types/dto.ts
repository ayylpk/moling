/**
 * DTO —— Data Transfer Object，调用方传进来的数据。
 *
 * 和 Entity 的区别：DTO 里没有 id、created_at、updated_at
 * （这三个是数据库自己生成的，调用方不该填），
 * 而且数组字段在 DTO 里是「真数组」，到写库那一刻才 stringify。
 *
 * 注意：TS 的类型只在编译期存在，运行时传错照样能跑。
 * 要真拦住，得在函数里手写 Array.isArray 检查（见 storyPlannerDB.ts）。
 */
import type { Rule, Faction, Place, Term } from './entity'

/** 新建一本小说的世界观 */
export interface CreateWorldDTO {
  novel_id: number
  name: string
  premise: string
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
