import type { Database } from 'bun:sqlite'

/**
 * 地点卡 runtime —— per-novel 库的地点写入 / 读取入口。
 *
 * ── 这张表为什么是自引用的 ──
 * `parent_id → locations.id`。世界观只铺**粗骨架**（临江老街），细粒度地点
 * （老粮站晒台）由剧情按需生长，但**必须挂得上去** —— 物理上挂在已有地点之下，
 * 不能平铺成一堆同级名字。外键保证"子地点不可能挂在不存在的地点下"。
 *
 * ── 粗骨架是谁放进来的 ──
 * `worldRuntime.create` 落世界观时，会把 places 逐条物化成这里的根节点。
 * 这一步不能省：骨架不进表，parent 填了它的地点就没有 id 可指，而且会被
 * `unresolvedParents()` **永久**报成待办（详见 worldRuntime 的 materializePlaces）。
 *
 * ── raw + 可空 id，是这一层的通用形态 ──
 * `parent_raw` 是卡上原样写的上级地名，`parent_id` 是查表解析的结果。
 * **解析不到不是错误，是待办状态**（父地点还没建），留 NULL，
 * 等父地点建好之后用 resolvePendingChildren 回头补上。
 *
 * ── NEW: 前缀永不解析 ──
 * `NEW:` 描述的是**需求**（"一个能撞见仇人的地方"），不是名字。
 * 拿它去查表可能撞到一个碰巧同名的地点，所以判定为需求时直接不解析。
 */
export type LocationInput = {
  name: string
  /** 上级地名的名字（Location agent 的 parent 字段） */
  parent?: string
  /** 显式 raw，优先于 parent —— 需要保留原文时用 */
  parentRaw?: string
  /** 已经解析好的父 id。显式给了就不再按名字查 */
  parentId?: number | null
  signature?: string
  features?: string[]
  role?: string
}

export type LocationPatch = {
  name?: string
  parentRaw?: string
  /** 允许显式写 null：把一个地点提成根节点 */
  parentId?: number | null
  signature?: string
  features?: string[]
  role?: string
}

export type Location = {
  id: number
  name: string
  parentRaw: string
  parentId: number | null
  signature: string
  features: string[]
  role: string
  createdAt: string
  updatedAt: string
}

export type LocationCreateResult = { location: Location; created: boolean }

const NEW_PREFIX = 'NEW:'
const isDemand = (raw: string): boolean => raw.trim().toUpperCase().startsWith(NEW_PREFIX)

export const createLocationRuntime = (database: Database) => {
  const read = (id: number): Location | null => {
    const row = database.query('SELECT * FROM locations WHERE id = ?').get(id) as Record<string, unknown> | null
    return row ? toLocation(row) : null
  }

  const readByName = (name: string): Location | null => {
    const row = database.query('SELECT * FROM locations WHERE name = ?').get(name.trim()) as Record<string, unknown> | null
    return row ? toLocation(row) : null
  }

  const create = (input: LocationInput): LocationCreateResult => {
    assertInput(input)
    const existing = readByName(input.name)
    if (existing) return { location: existing, created: false }

    const parentRaw = (input.parentRaw ?? input.parent ?? '').trim()
    const parentId = resolveParentId(input, parentRaw)

    const result = database
      .query(`INSERT INTO locations (name, parent_raw, parent_id, signature, features, role) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.name.trim(), parentRaw, parentId, input.signature ?? '', JSON.stringify(input.features ?? []), input.role ?? '')
    return { location: read(Number(result.lastInsertRowid))!, created: true }
  }

  /**
   * 显式 parentId 优先；否则按 parent_raw **精确**查表（不做模糊匹配 ——
   * 模糊匹配会把"青州"匹配到"青州旧址"，那是两个地方）。
   * 需求（NEW:）不查表。
   */
  const resolveParentId = (input: LocationInput, parentRaw: string): number | null => {
    if (input.parentId !== undefined) return input.parentId
    if (!parentRaw || isDemand(parentRaw)) return null
    return readByName(parentRaw)?.id ?? null
  }

  const update = (id: number, patch: LocationPatch): Location | null => {
    const sets: string[] = []
    const params: Array<string | number | null> = []

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new TypeError('name 不能为空')
      sets.push('name = ?')
      params.push(patch.name.trim())
    }
    if (patch.parentRaw !== undefined) {
      sets.push('parent_raw = ?')
      params.push(patch.parentRaw.trim())
    }
    // parentId 的判据是「key 在不在补丁里」，而不是值真不真 —— 显式 null 是有意义的
    if ('parentId' in patch) {
      sets.push('parent_id = ?')
      params.push(patch.parentId ?? null)
    }
    if (patch.signature !== undefined) {
      sets.push('signature = ?')
      params.push(patch.signature)
    }
    if (patch.features !== undefined) {
      sets.push('features = ?')
      params.push(JSON.stringify(patch.features))
    }
    if (patch.role !== undefined) {
      sets.push('role = ?')
      params.push(patch.role)
    }

    if (sets.length === 0) return read(id)
    database
      .query(`UPDATE locations SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(...params, id)
    return read(id)
  }

  /**
   * 父地点建好之后，回头把同一名字下未解析的挂载补上。返回挂上了几个子地点。
   * 场景：先建「青州旧观的水井」（parent_raw = 青州），后来才建「青州」。
   */
  const resolvePendingChildren = (parentName: string, parentId: number): number => {
    return database
      .query(
        `UPDATE locations SET parent_id = ?, updated_at = datetime('now','localtime')
         WHERE parent_id IS NULL AND parent_raw = ?`,
      )
      .run(parentId, parentName.trim()).changes
  }

  return {
    create,
    get: read,
    getByName: readByName,
    list(): Location[] {
      return (database.query('SELECT * FROM locations ORDER BY id').all() as Array<Record<string, unknown>>).map(toLocation)
    },
    /** 某个地点下的直接子地点。搭层级树用 */
    children(parentId: number): Location[] {
      return (database.query('SELECT * FROM locations WHERE parent_id = ? ORDER BY id').all(parentId) as Array<Record<string, unknown>>).map(toLocation)
    },
    /** 根节点（世界观粗骨架，没有上级的那些） */
    roots(): Location[] {
      return (database.query('SELECT * FROM locations WHERE parent_id IS NULL ORDER BY id').all() as Array<Record<string, unknown>>).map(toLocation)
    },
    /** 有 parent_raw 但还没解析出 parent_id 的 —— 待建清单的一半 */
    unresolvedParents(): Location[] {
      return (
        database.query(`SELECT * FROM locations WHERE parent_id IS NULL AND parent_raw <> '' ORDER BY id`).all() as Array<Record<string, unknown>>
      ).map(toLocation)
    },
    update,
    resolvePendingChildren,
  }
}

const assertInput = (input: LocationInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('地点必须是对象')
  if (!input.name?.trim()) throw new TypeError('name 不能为空')
  if (input.features !== undefined && !Array.isArray(input.features)) throw new TypeError('features 必须是数组')
}

const parse = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(value ?? '')) as T
  } catch {
    return fallback
  }
}

const toLocation = (row: Record<string, unknown>): Location => ({
  id: Number(row.id),
  name: String(row.name),
  parentRaw: String(row.parent_raw),
  parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
  signature: String(row.signature),
  features: parse<string[]>(row.features, []),
  role: String(row.role),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})
