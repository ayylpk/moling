/**
 * 世界观业务层。
 *
 * 职责就三件，别的不要往里塞：
 *   1. 校验 + 补全 —— DTO 进来先检查，补默认值、补时间
 *   2. 转换 —— DTO -> Entity 行（数组 stringify）；Entity -> VO（JSON 解析回数组）
 *   3. 组装 —— 把 db 层的原子操作拼成一个业务动作
 *
 * controller 只调这一层，不直接碰 db。
 */
import * as store from '../db/storyPlannerDB'
import type { NewWorldRow, WorldRowPatch } from '../db/storyPlannerDB'
import type {
  CreateWorldDTO,
  UpdateWorldDTO,
  WorldVO,
  WorldBriefVO,
  WorldEntity,
  Rule,
  Faction,
  Place,
  Term,
} from '../../../db/types'

/** 库里存 JSON 文本的 5 个字段 */
const ARR_KEYS = ['rules', 'factions', 'places', 'terms', 'forbidden'] as const

/* ==================== 时间 ==================== */

/**
 * 生成和 SQLite datetime('now','localtime') 完全同格式的字符串：2026-09-28 18:12:11
 *
 * 为什么不用现成的：new Date().toISOString() 出来是 UTC 的 ISO 格式
 * （2026-09-28T10:12:11.000Z），跟库里已有的字符串格式对不上 ——
 * 混着存的话，字符串排序和比较全是错的。
 *
 * 格式要统一，就统一成 SQLite 这一套。
 */
export const now = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

/* ==================== 转换 ==================== */

/** Entity -> VO：把 5 个 JSON 文本解析回真数组 */
const toVO = (e: WorldEntity): WorldVO => ({
  ...e,
  rules: JSON.parse(e.rules) as Rule[],
  factions: JSON.parse(e.factions) as Faction[],
  places: JSON.parse(e.places) as Place[],
  terms: JSON.parse(e.terms) as Term[],
  forbidden: JSON.parse(e.forbidden) as string[],
})

/** DTO -> Entity 行：数组 stringify，没传的补空数组 */
const toRow = (dto: CreateWorldDTO): NewWorldRow => ({
  novel_id: dto.novel_id,
  name: dto.name.trim(),
  premise: dto.premise.trim(),
  rules: JSON.stringify(dto.rules ?? []),
  factions: JSON.stringify(dto.factions ?? []),
  places: JSON.stringify(dto.places ?? []),
  terms: JSON.stringify(dto.terms ?? []),
  forbidden: JSON.stringify(dto.forbidden ?? []),
})

/* ==================== 校验 ==================== */
// TS 的 interface 编译后就没了，运行时传错照样能跑。
// 真检查放这一层 —— 这是 service 的活儿，db 层不管。

const assertCreateDTO = (dto: CreateWorldDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (!Number.isInteger(dto.novel_id)) throw new TypeError('novel_id 必须是整数')
  if (!dto.name?.trim()) throw new TypeError('name 不能为空')
  if (!dto.premise?.trim()) throw new TypeError('premise 不能为空')

  for (const key of ARR_KEYS) {
    const v = dto[key]
    if (v !== undefined && !Array.isArray(v)) {
      throw new TypeError(`${key} 必须是数组，收到 ${typeof v}`)
    }
  }
}

const assertUpdateDTO = (dto: UpdateWorldDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (dto.name !== undefined && !dto.name.trim()) throw new TypeError('name 不能是空字符串')
  if (dto.premise !== undefined && !dto.premise.trim()) {
    throw new TypeError('premise 不能是空字符串')
  }

  for (const key of ARR_KEYS) {
    const v = dto[key]
    if (v !== undefined && !Array.isArray(v)) {
      throw new TypeError(`${key} 必须是数组，收到 ${typeof v}`)
    }
  }
}

/* ==================== 业务 ==================== */

/** 新建，返回建好的完整数据 */
export const createWorld = (dto: CreateWorldDTO): WorldVO => {
  assertCreateDTO(dto)
  const id = store.insertWorld(toRow(dto))
  // 刚插进去必然能查到；查不到说明连接或事务出了问题，宁可炸掉
  return toVO(store.selectWorld(id)!)
}

/** 按 id 取一条，没有返回 null */
export const getWorld = (id: number): WorldVO | null => {
  const e = store.selectWorld(id)
  return e ? toVO(e) : null
}

/** novelId 传了就按小说过滤，不传就返回全部 */
export const listWorlds = (novelId?: number): WorldVO[] => {
  const rows = novelId === undefined ? store.selectWorlds() : store.selectWorldsByNovel(novelId)
  return rows.map(toVO)
}

/** 精简列表：只给规则条数，不拉 5 个大 JSON */
export const listWorldBriefs = (novelId: number): WorldBriefVO[] =>
  store.selectWorldBriefsByNovel(novelId)

/** 按规则内容搜关键词 */
export const searchByRule = (keyword: string): WorldBriefVO[] => {
  if (!keyword?.trim()) throw new TypeError('关键词不能为空')
  return store.selectWorldsByRule(keyword.trim())
}

/** 更新：只改传了的字段，返回更新后的完整数据；id 不存在返回 null */
export const updateWorld = (id: number, dto: UpdateWorldDTO): WorldVO | null => {
  assertUpdateDTO(dto)

  const patch: WorldRowPatch = {}
  if (dto.name !== undefined) patch.name = dto.name.trim()
  if (dto.premise !== undefined) patch.premise = dto.premise.trim()
  for (const key of ARR_KEYS) {
    const v = dto[key]
    if (v !== undefined) patch[key] = JSON.stringify(v) as never
  }
  // 时间在这一层补，不靠数据库默认值 —— 默认值只在 INSERT 时生效，UPDATE 不触发
  patch.updated_at = now()

  store.updateWorldRow(id, patch)
  const e = store.selectWorld(id)
  return e ? toVO(e) : null
}

/** 删除，返回是否真的删掉了（false = 本来就没这条） */
export const deleteWorld = (id: number): boolean => store.deleteWorld(id) > 0
