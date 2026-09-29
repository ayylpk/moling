/**
 * VO —— View Object，返回出去给调用方看的数据。
 *
 * 和 Entity 的区别：JSON 文本已经解析成真数组，用起来可以直接 .map / .length，
 * 不用每处都写一遍 JSON.parse。
 */
import type { Rule, Faction, Place, Term } from './entity'

/** 单个世界观的完整数据 */
export interface WorldVO {
  id: number
  novel_id: number
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
  name: string
  premise: string
  ruleCount: number
}
