import type { Database } from 'bun:sqlite'

/**
 * 大纲 runtime —— 全篇锚点（outline_anchors）与卷级大纲（outline_volumes）的写读入口。
 *
 * ── 为什么拆成两张表 ──
 *   outline_anchors —— 全篇锚点，一本小说**一行**（per-novel 库里 id 固定为 1）。
 *                      由第一卷定稿，之后每卷原样回填、禁止重写。
 *   outline_volumes —— 本卷的幕 / 转折点 / 节奏 / 约束 **+ 回填的锚点副本**。
 *
 * ── 锚点为什么只写一次 ──
 * 「锚点漂移」是**缺陷，不是编辑**。后续卷提交了不同的锚点，我们的活是把它**测出来**
 * （saveAnchor 返回 drift），不是替调用方把库里的锚点改掉 —— 一旦静默覆盖，
 * 已生成的卷就无法判断自己基于哪版锚点，漂移检查整个失效。
 * 要真的改锚点，应当重跑第一卷（或显式 overwrite: true）。
 *
 * ── anchor_snapshot 存的是「这一卷实际提交的锚点」 ──
 * 不是库里已生效的那份。存反了，漂移检查就是死的：提交了不同锚点的那一卷，
 * 快照看起来永远"没漂"，listDriftedVolumeIds 会永远返回空。
 *
 * ── 不重复世界观测 ──
 * 这里只收 direction / structure / pacing / constraints 这一层；
 * **世界观（worlds）一个字都不往这两张表里抄**。锚点要引用规则时只引用（记 id / 名字），
 * 不复述 —— 复述出来的副本会随世界观改版而失真。
 *
 * ── 比对必须字段级解析 ──
 * 库里 main_plot / subplots 是 JSON **字符串**，提交上来的是对象。
 * 若不逐字段 parse，字符串和对象永远不相等，漂移检查会永远报 true（真出过这个 bug）。
 * 另外序列化前按 key 排序：两次生成的键序不同不该算漂移，误报比不报更糟。
 */
export type AnchorInput = {
  logline: string
  theme?: string
  coreConflict?: string
  endingDirection: string
  structureType: string
  mainPlot: unknown
  subplots?: unknown
  /** 哪一卷定的稿。第一卷写 1 */
  lockedByVolume?: number | null
}

export type Anchor = {
  id: number
  logline: string
  theme: string
  coreConflict: string
  endingDirection: string
  structureType: string
  mainPlot: unknown
  subplots: unknown[]
  lockedByVolume: number | null
  lockedAt: string
}

export type VolumeOutlineInput = {
  volumeId: number
  structureType?: string
  acts?: unknown[]
  turningPoints?: unknown[]
  pacing?: unknown
  constraints?: unknown
  /**
   * 这一卷**实际提交的锚点**（通常是 Architect 这一卷返回的 direction/structure）。
   * 缺省 = 这一卷按当前生效的锚点生成，快照记当前锚点、不算漂移。
   */
  anchorSnapshot?: AnchorInput
}

export type VolumeOutline = {
  id: number
  volumeId: number
  structureType: string
  acts: unknown[]
  turningPoints: unknown[]
  pacing: unknown
  constraints: unknown
  anchorSnapshot: unknown
  /** 这卷当时回填的锚点和现在生效的锚点对不上 */
  drift: boolean
  createdAt: string
  updatedAt: string
}

/** 参与漂移比对的那几个字段，规范化后的形状（camel，JSON 已解析） */
type AnchorCore = {
  logline: string
  theme: string
  coreConflict: string
  endingDirection: string
  structureType: string
  mainPlot: unknown
  subplots: unknown
}

export type SaveAnchorResult = { anchor: Anchor; drift: boolean; written: boolean }
export type SaveVolumeOutlineResult = { outline: VolumeOutline; drift: boolean }

/* ==================== 规范化 ==================== */

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]))
  }
  return v
}

const parseMaybe = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v) as unknown
  } catch {
    return v
  }
}

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

/**
 * 把「提交上来的锚点」或「库里的锚点行」或「已存的快照」统一成 AnchorCore。
 * 三种形态都要吃，所以键名（camel/snake）和 JSON 字符串都在这里一次性消化掉。
 */
const normalizeCore = (v: unknown): AnchorCore | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const logline = pick(o, 'logline')
  if (logline === undefined) return null
  return {
    logline: String(logline ?? ''),
    theme: String(pick(o, 'theme') ?? ''),
    coreConflict: String(pick(o, 'coreConflict', 'core_conflict') ?? ''),
    endingDirection: String(pick(o, 'endingDirection', 'ending_direction') ?? ''),
    structureType: String(pick(o, 'structureType', 'structure_type') ?? ''),
    mainPlot: parseMaybe(pick(o, 'mainPlot', 'main_plot') ?? {}),
    subplots: parseMaybe(pick(o, 'subplots') ?? []),
  }
}

const anchorCore = (v: unknown): string | null => {
  const core = normalizeCore(v)
  return core === null ? null : JSON.stringify(sortKeys(core))
}

/* ==================== runtime ==================== */

export const createOutlineRuntime = (database: Database) => {
  const readAnchorRow = (): Record<string, unknown> | null =>
    (database.query('SELECT * FROM outline_anchors WHERE id = 1').get() as Record<string, unknown> | null)

  const readVolumeRow = (volumeId: number): Record<string, unknown> | null =>
    (database.query('SELECT * FROM outline_volumes WHERE volume_id = ?').get(volumeId) as Record<string, unknown> | null)

  const currentAnchor = (): Anchor | null => {
    const row = readAnchorRow()
    return row ? toAnchor(row) : null
  }

  /**
   * 写全篇锚点。
   *   · 库里还没有 → 写入（第一卷定稿），drift 恒为 false。
   *   · 已有 → **默认不覆盖**，只把提交的那份和已生效的比一下，返回 drift。
   *     确需覆盖（例如第一卷重跑且已确认放弃旧锚点）才传 overwrite。
   */
  const saveAnchor = (input: AnchorInput, opts: { overwrite?: boolean } = {}): SaveAnchorResult => {
    assertAnchor(input)
    const existing = readAnchorRow()
    if (!existing) {
      database
        .query(
          `INSERT INTO outline_anchors (id, logline, theme, core_conflict, ending_direction, structure_type, main_plot, subplots, locked_by_volume)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.logline.trim(),
          input.theme ?? '',
          input.coreConflict ?? '',
          input.endingDirection.trim(),
          input.structureType.trim(),
          JSON.stringify(input.mainPlot ?? {}),
          JSON.stringify(input.subplots ?? []),
          input.lockedByVolume ?? null,
        )
      return { anchor: currentAnchor()!, drift: false, written: true }
    }

    const drift = anchorCore(input) !== anchorCore(existing)
    if (!opts.overwrite || !drift) return { anchor: toAnchor(existing), drift, written: false }

    database
      .query(
        `UPDATE outline_anchors
           SET logline = ?, theme = ?, core_conflict = ?, ending_direction = ?, structure_type = ?,
               main_plot = ?, subplots = ?, locked_by_volume = ?, locked_at = datetime('now','localtime')
         WHERE id = 1`,
      )
      .run(
        input.logline.trim(),
        input.theme ?? '',
        input.coreConflict ?? '',
        input.endingDirection.trim(),
        input.structureType.trim(),
        JSON.stringify(input.mainPlot ?? {}),
        JSON.stringify(input.subplots ?? []),
        input.lockedByVolume ?? null,
      )
    return { anchor: currentAnchor()!, drift, written: true }
  }

  /** 不写库，只比一下提交的锚点和当前生效的是否一致。给"提交前先看一眼"用 */
  const checkAnchorDrift = (input: AnchorInput): { drift: boolean; hasAnchor: boolean } => {
    const existing = readAnchorRow()
    if (!existing) return { drift: false, hasAnchor: false }
    return { drift: anchorCore(input) !== anchorCore(existing), hasAnchor: true }
  }

  /**
   * 写一卷的卷纲。按 volume_id UPSERT（表上有 UNIQUE(volume_id)）。
   *
   * 快照 = 这一卷实际提交的锚点；没提交就记当前生效的锚点（视为这卷与锚点一致）。
   */
  const saveVolumeOutline = (input: VolumeOutlineInput): SaveVolumeOutlineResult => {
    if (!Number.isInteger(input?.volumeId)) throw new TypeError('volumeId 必须是整数')
    const snapshot = input.anchorSnapshot === undefined ? currentAnchor() : normalizeCore(input.anchorSnapshot)
    if (input.anchorSnapshot !== undefined && snapshot === null) throw new TypeError('anchorSnapshot 缺少 logline')

    database
      .query(
        `INSERT INTO outline_volumes (volume_id, structure_type, acts, turning_points, pacing, constraints, anchor_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(volume_id) DO UPDATE SET
           structure_type  = excluded.structure_type,
           acts            = excluded.acts,
           turning_points  = excluded.turning_points,
           pacing          = excluded.pacing,
           constraints     = excluded.constraints,
           anchor_snapshot = excluded.anchor_snapshot,
           updated_at      = datetime('now','localtime')`,
      )
      .run(
        input.volumeId,
        input.structureType ?? '',
        JSON.stringify(input.acts ?? []),
        JSON.stringify(input.turningPoints ?? []),
        JSON.stringify(input.pacing ?? {}),
        JSON.stringify(input.constraints ?? {}),
        JSON.stringify(snapshot ?? {}),
      )

    return { outline: getVolumeOutline(input.volumeId)!, drift: isDrifted(snapshot) }
  }

  /** 快照 vs 当前锚点。没有锚点或没有快照时判为不漂 */
  const isDrifted = (snapshot: unknown): boolean => {
    const anchor = readAnchorRow()
    const snapCore = anchorCore(snapshot)
    if (!anchor || snapCore === null || snapshot === null) return false
    return snapCore !== anchorCore(anchor)
  }

  const getVolumeOutline = (volumeId: number): VolumeOutline | null => {
    const row = readVolumeRow(volumeId)
    return row ? toVolumeOutline(row, isDrifted(parseMaybe(row.anchor_snapshot))) : null
  }

  const listVolumeOutlines = (): VolumeOutline[] => {
    const rows = database.query('SELECT * FROM outline_volumes ORDER BY volume_id').all() as Array<Record<string, unknown>>
    return rows.map((row) => toVolumeOutline(row, isDrifted(parseMaybe(row.anchor_snapshot))))
  }

  /** 漂移报告：哪几卷回填的锚点和现在生效的对不上 */
  const listDriftedVolumeIds = (): number[] => {
    const rows = database.query('SELECT volume_id, anchor_snapshot FROM outline_volumes ORDER BY volume_id').all() as Array<{
      volume_id: number
      anchor_snapshot: string
    }>
    return rows.filter((row) => isDrifted(parseMaybe(row.anchor_snapshot))).map((row) => Number(row.volume_id))
  }

  return {
    saveAnchor,
    currentAnchor,
    checkAnchorDrift,
    saveVolumeOutline,
    getVolumeOutline,
    listVolumeOutlines,
    listDriftedVolumeIds,
  }
}

const assertAnchor = (input: AnchorInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('锚点必须是对象')
  if (!input.logline?.trim()) throw new TypeError('logline 不能为空')
  if (!input.endingDirection?.trim()) throw new TypeError('endingDirection 不能为空')
  if (!input.structureType?.trim()) throw new TypeError('structureType 不能为空')
  if (input.mainPlot === undefined || input.mainPlot === null) throw new TypeError('mainPlot 不能为空')
  if (input.subplots !== undefined && input.subplots !== null && typeof input.subplots !== 'object' && typeof input.subplots !== 'string') {
    throw new TypeError('subplots 必须是对象 / 数组 / JSON 字符串')
  }
}

const toAnchor = (row: Record<string, unknown>): Anchor => ({
  id: Number(row.id),
  logline: String(row.logline),
  theme: String(row.theme),
  coreConflict: String(row.core_conflict),
  endingDirection: String(row.ending_direction),
  structureType: String(row.structure_type),
  mainPlot: parseMaybe(row.main_plot),
  subplots: (parseMaybe(row.subplots) as unknown[]) ?? [],
  lockedByVolume: row.locked_by_volume === null || row.locked_by_volume === undefined ? null : Number(row.locked_by_volume),
  lockedAt: String(row.locked_at),
})

const toVolumeOutline = (row: Record<string, unknown>, drift: boolean): VolumeOutline => ({
  id: Number(row.id),
  volumeId: Number(row.volume_id),
  structureType: String(row.structure_type),
  acts: (parseMaybe(row.acts) as unknown[]) ?? [],
  turningPoints: (parseMaybe(row.turning_points) as unknown[]) ?? [],
  pacing: parseMaybe(row.pacing),
  constraints: parseMaybe(row.constraints),
  anchorSnapshot: parseMaybe(row.anchor_snapshot),
  drift,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})
