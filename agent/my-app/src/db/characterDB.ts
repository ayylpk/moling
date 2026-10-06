import type { Database } from 'bun:sqlite'

/**
 * 角色卡 runtime —— per-novel 库的角色写入 / 读取入口。
 *
 * ── 为什么没有 novel_id ──
 * 历史版本的 characters 曾采用单库多小说模式并带 novel_id；当前正式模型是一本小说一个文件
 *（resources/novels/<slug>/novel.sqlite），
 * **库本身就是边界**，所以这里的签名里没有 novel_id —— 传了反而说明调用方还没换脑。
 *
 * ── 与 character_portraits 的分工：固定 vs 动态，必须互补 ──
 * 本表存**固定设定**（voice / want / cost / arc…），是这条流水线的输入，模型不该随剧情改它；
 * character_portraits（storage/portraitPipeline.ts 写）存**随剧情生长的画像**。
 * 所以 runtime 一个字都不碰 character_portraits —— 一旦这里也去写画像，
 * 「设定」就会被「画像」覆盖，角色会随着章节漂移。
 *
 * ── 为什么是 update 而不是 createVersion ──
 * characters 表**没有 version 列**。worlds 之所以带 version，是因为要能回答
 * 「这一卷基于哪一版世界观生成的」；角色卡不需要回答这个（大纲引用的是角色本身）。
 * 所以改设定就是原地 UPDATE。
 *
 * 入参形状对着 Character agent 的 CharacterSchema：那边 `arc` 是 {start,end}，
 * 库里拆成 arc_start / arc_end 两列 —— 「起点 ≠ 终点」是这张卡有没有推进的判据，
 * 埋进 JSON 就没法用 SQL 比。
 */
export type CharacterRole = 'protagonist' | 'antagonist' | 'support'
export type CharacterStatus = 'alive' | 'dead' | 'disabled'
export type CharacterSource = 'agent' | 'hand'

export type CharacterInput = {
  name: string
  role: CharacterRole
  /** 不可改的可感知事实（身体、出身） */
  immutable?: string[]
  voice?: string
  want?: string
  cost?: string
  need?: string
  secret?: string
  reveal?: string
  /** 底线：越线即翻脸 */
  line?: string
  flaw?: string
  arc?: { start?: string; end?: string }
  status?: CharacterStatus
  source?: CharacterSource
}

/** 改卡片的补丁。字段名和库里一致（arc 已拆开） */
export type CharacterPatch = {
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
  arcStart?: string
  arcEnd?: string
  status?: CharacterStatus
  source?: CharacterSource
}

export type Character = {
  id: number
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
  arcStart: string
  arcEnd: string
  status: CharacterStatus
  source: CharacterSource
  createdAt: string
  updatedAt: string
}

/** 摘要列表用：不搬全文，只回答「场上有谁」 */
export type CharacterBrief = Pick<Character, 'id' | 'name' | 'role' | 'status' | 'source'>

export type CharacterCreateResult = { character: Character; created: boolean }

const ROLE_SET: ReadonlySet<string> = new Set(['protagonist', 'antagonist', 'support'])
const STATUS_SET: ReadonlySet<string> = new Set(['alive', 'dead', 'disabled'])
const SOURCE_SET: ReadonlySet<string> = new Set(['agent', 'hand'])

/** 排除 name / role（它们是插入时必填的定位字段，走各自的校验） */
const PATCH_TEXT_KEYS = [
  'voice',
  'want',
  'cost',
  'need',
  'secret',
  'reveal',
  'line',
  'flaw',
  'arc_start',
  'arc_end',
] as const

export const createCharacterRuntime = (database: Database) => {
  const read = (id: number): Character | null => {
    const row = database.query('SELECT * FROM characters WHERE id = ?').get(id) as Record<string, unknown> | null
    return row ? toCharacter(row) : null
  }

  const readByName = (name: string): Character | null => {
    const row = database.query('SELECT * FROM characters WHERE name = ?').get(name.trim()) as Record<string, unknown> | null
    return row ? toCharacter(row) : null
  }

  /**
   * 建卡。名字是 UNIQUE —— 同名再建会报错。
   *
   * 「一次一个」是全项目的约定（批量从第三五个起必然退化成模板），
   * 所以这里不做批量接口；要建几个就调几次。
   */
  const create = (input: CharacterInput): CharacterCreateResult => {
    assertInput(input)
    const existing = readByName(input.name)
    if (existing) return { character: existing, created: false }
    const result = database
      .query(
        `INSERT INTO characters
           (name, role, immutable, voice, want, cost, need, secret, reveal, line, flaw, arc_start, arc_end, status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name.trim(),
        input.role,
        JSON.stringify(input.immutable ?? []),
        input.voice ?? '',
        input.want ?? '',
        input.cost ?? '',
        input.need ?? '',
        input.secret ?? '',
        input.reveal ?? '',
        input.line ?? '',
        input.flaw ?? '',
        input.arc?.start ?? '',
        input.arc?.end ?? '',
        input.status ?? 'alive',
        input.source ?? 'agent',
      )
    return { character: read(Number(result.lastInsertRowid))!, created: true }
  }

  /**
   * 改卡。白名单拼 SQL —— 列名只从代码里的常量取，不信任传入的 key。
   * 返回改后的完整卡；id 不存在返回 null（而不是抛错：调用方常拿它当"存在吗"用）。
   */
  const update = (id: number, patch: CharacterPatch): Character | null => {
    const sets: string[] = []
    const params: Array<string | number | null> = []

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new TypeError('name 不能为空')
      sets.push('name = ?')
      params.push(patch.name.trim())
    }
    if (patch.role !== undefined) {
      if (!ROLE_SET.has(patch.role)) throw new TypeError(`role 只能是 ${[...ROLE_SET].join(' / ')}`)
      sets.push('role = ?')
      params.push(patch.role)
    }
    if (patch.status !== undefined) {
      if (!STATUS_SET.has(patch.status)) throw new TypeError(`status 只能是 ${[...STATUS_SET].join(' / ')}`)
      sets.push('status = ?')
      params.push(patch.status)
    }
    if (patch.source !== undefined) {
      if (!SOURCE_SET.has(patch.source)) throw new TypeError(`source 只能是 ${[...SOURCE_SET].join(' / ')}`)
      sets.push('source = ?')
      params.push(patch.source)
    }
    if (patch.immutable !== undefined) {
      sets.push('immutable = ?')
      params.push(JSON.stringify(patch.immutable))
    }
    for (const key of PATCH_TEXT_KEYS) {
      // key 是库里的列名，patch 里的 key 是驼峰，逐个映射
      const value = patch[camel(key)]
      if (value === undefined) continue
      sets.push(`${key} = ?`)
      params.push(value)
    }

    if (sets.length === 0) return read(id)
    database
      .query(`UPDATE characters SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(...params, id)
    return read(id)
  }

  return {
    create,
    get: read,
    getByName: readByName,
    list(): Character[] {
      return (database.query('SELECT * FROM characters ORDER BY id').all() as Array<Record<string, unknown>>).map(toCharacter)
    },
    /** 索引：只回名字/id/定位，派活前先看它，别用全文去喂子 agent */
    briefs(): CharacterBrief[] {
      return database.query('SELECT id, name, role, status, source FROM characters ORDER BY id').all() as CharacterBrief[]
    },
    update,
  }
}

/** 纯文本列在补丁里的字段名（窄联合，避免把 immutable 之类的非字符串混进来） */
type PatchTextField = 'voice' | 'want' | 'cost' | 'need' | 'secret' | 'reveal' | 'line' | 'flaw' | 'arcStart' | 'arcEnd'

/** 驼峰补丁字段 → 库里列名（arc_start / arc_end 这两处不通用，单独给） */
const PATCH_FIELD_MAP: Record<string, PatchTextField> = {
  voice: 'voice',
  want: 'want',
  cost: 'cost',
  need: 'need',
  secret: 'secret',
  reveal: 'reveal',
  line: 'line',
  flaw: 'flaw',
  arc_start: 'arcStart',
  arc_end: 'arcEnd',
}
const camel = (column: string): PatchTextField => PATCH_FIELD_MAP[column]!

const assertInput = (input: CharacterInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('角色必须是对象')
  if (!input.name?.trim()) throw new TypeError('name 不能为空')
  if (!input.role) throw new TypeError('role 不能为空')
  if (!ROLE_SET.has(input.role)) throw new TypeError(`role 只能是 ${[...ROLE_SET].join(' / ')}`)
  if (input.immutable !== undefined && !Array.isArray(input.immutable)) throw new TypeError('immutable 必须是数组')
  if (input.status !== undefined && !STATUS_SET.has(input.status)) throw new TypeError(`status 只能是 ${[...STATUS_SET].join(' / ')}`)
}

const parse = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(value ?? '')) as T
  } catch {
    return fallback
  }
}

const toCharacter = (row: Record<string, unknown>): Character => ({
  id: Number(row.id),
  name: String(row.name),
  role: row.role as CharacterRole,
  immutable: parse<string[]>(row.immutable, []),
  voice: String(row.voice),
  want: String(row.want),
  cost: String(row.cost),
  need: String(row.need),
  secret: String(row.secret),
  reveal: String(row.reveal),
  line: String(row.line),
  flaw: String(row.flaw),
  arcStart: String(row.arc_start),
  arcEnd: String(row.arc_end),
  status: row.status as CharacterStatus,
  source: row.source as CharacterSource,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})
