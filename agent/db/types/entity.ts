/**
 * Entity —— 与数据库表一一对应的一层。
 *
 * 规则：字段类型 = 数据在 SQLite 里的真实形态。
 * rules / factions / places / terms / forbidden 在库里存的是 JSON 文本，
 * 所以这里就是 string，不是数组。解析成数组是 VO 那一层的事。
 *
 * 这一层不要加业务字段，也不要为了方便改类型 —— 加了就会和表结构对不上。
 */

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

/** worlds 表的一行 */
export interface WorldEntity {
  id: number
  novel_id: number
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
