import type { Database } from 'bun:sqlite'

import { createLocationRuntime } from './locationRuntime'

export type WorldRule = { ability: string; cost: string; limit: string }
export type WorldTerm = { name: string; note?: string }
export type WorldInput = {
  name: string
  premise: string
  rules?: WorldRule[]
  factions?: unknown[]
  places?: unknown[]
  terms?: WorldTerm[]
  forbidden?: string[]
}
export type World = WorldInput & { id: number; version: number; createdAt: string; updatedAt: string }

export const createWorldRuntime = (database: Database) => {
  const read = (id: number): World | null => {
    const row = database.query('SELECT * FROM worlds WHERE id = ?').get(id) as Record<string, unknown> | null
    return row ? toWorld(row) : null
  }

  return {
    create(input: WorldInput): World {
      assertWorld(input)
      const current = database.query('SELECT coalesce(max(version), 0) AS version FROM worlds').get() as { version: number }
      const version = Number(current.version) + 1
      const result = database.query(`INSERT INTO worlds (version, name, premise, rules, factions, places, terms, forbidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        version, input.name.trim(), input.premise.trim(), JSON.stringify(input.rules ?? []), JSON.stringify(input.factions ?? []), JSON.stringify(input.places ?? []), JSON.stringify(input.terms ?? []), JSON.stringify(input.forbidden ?? []),
      )
      const world = read(Number(result.lastInsertRowid))!

      // 世界观里的地名粗骨架必须落进 locations 表 —— 否则挂在其下的地点永远解析不到父级。
      // 这两步得在一起：worlds 行和 locations 行缺一个，父子关系就是断的。
      materializePlaces(database, world.places)

      return world
    },
    current(): World | null {
      const row = database.query('SELECT * FROM worlds ORDER BY version DESC LIMIT 1').get() as Record<string, unknown> | null
      return row ? toWorld(row) : null
    },
    list(): World[] {
      return (database.query('SELECT * FROM worlds ORDER BY version DESC').all() as Array<Record<string, unknown>>).map(toWorld)
    },
  }
}

/**
 * 把世界观里的地名粗骨架物化成 locations 的根节点。
 *
 * ── 为什么必须做 ──
 * 地点的 parent_id 是指向 locations.id 的外键。骨架（世界观里的「临江老街」）如果不进这张表，
 * 那么凡 parent 填了它的地点卡，解析出来一律是 NULL —— 而 unresolvedParents() 会**永远**
 * 把这条卡报成待办，因为不会有任何东西去建那条父级行。它不是「迟点会解析」，
 * 是一个不会自愈的循环。
 *
 * ── 幂等 ──
 * locationRuntime.create 遇到同名返回既有行、不覆盖，所以世界观改版重落时只会把新地名补进去，
 * 已有的精细地点卡不会被冲掉。
 *
 * ── 顺手回填 ──
 * 作者可能先建了地点卡（parent 写了骨架地名，当时解析不出来），后来才落世界观 ——
 * 所以每物化一个名字，都回头把它底下还没解析的子地点挂上去。
 *
 * ── where 为什么落在 features 里 ──
 * locations 表没有独立的「位于」列，而骨架只有 name / where / role 三样。
 * where 是位置描述，放 features 是就近安置 —— 读的时候别把它当成地点卡的「细节特征」。
 */
const materializePlaces = (database: Database, places: unknown[] | undefined): void => {
  const locations = createLocationRuntime(database)
  for (const item of places ?? []) {
    if (!item || typeof item !== 'object') continue
    const place = item as { name?: unknown; where?: unknown; role?: unknown }
    const name = String(place.name ?? '').trim()
    if (!name) continue
    const where = String(place.where ?? '').trim()
    const result = locations.create({
      name,
      features: where ? [where] : [],
      role: String(place.role ?? ''),
    })
    locations.resolvePendingChildren(name, result.location.id)
  }
}

const assertWorld = (input: WorldInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('世界观必须是对象')
  if (!input.name?.trim()) throw new TypeError('name 不能为空')
  if (!input.premise?.trim()) throw new TypeError('premise 不能为空')
  if (input.rules !== undefined && !Array.isArray(input.rules)) throw new TypeError('rules 必须是数组')
  if (input.terms !== undefined && !Array.isArray(input.terms)) throw new TypeError('terms 必须是数组')
}

const parse = <T>(value: unknown, fallback: T): T => {
  try { return JSON.parse(String(value ?? '')) as T } catch { return fallback }
}
const toWorld = (row: Record<string, unknown>): World => ({
  id: Number(row.id), version: Number(row.version), name: String(row.name), premise: String(row.premise),
  rules: parse<WorldRule[]>(row.rules, []), factions: parse<unknown[]>(row.factions, []), places: parse<unknown[]>(row.places, []), terms: parse<WorldTerm[]>(row.terms, []), forbidden: parse<string[]>(row.forbidden, []),
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
})
