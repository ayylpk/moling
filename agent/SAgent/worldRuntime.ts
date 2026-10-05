import type { Database } from 'bun:sqlite'

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
      return read(Number(result.lastInsertRowid))!
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
