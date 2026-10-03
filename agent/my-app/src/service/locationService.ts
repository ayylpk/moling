/**
 * 地点业务层。
 *
 * 核心是「层级挂载」：世界观只铺粗骨架（青州、京城），细粒度地点
 * （旧观那口枯井、城东当铺）在剧情推进到那一步时才按需生成，
 * 但**必须挂得上去** —— 靠 parent_id 自引用外键。
 *
 * 跟角色那边同一个套路：parent 写的是名字，落库时解析成 id，
 * 解析不到留 NULL（父地点还没建），建好后回头补。
 */
import * as store from '../db/locationDB'
import type { NewLocationRow, LocationRowPatch } from '../db/locationDB'
import { withTransaction } from '../db/createDB'
import { now } from '../shared/time'
import { isDemand, normalizeRaw } from '../shared/demand'
import type {
  CreateLocationDTO,
  UpdateLocationDTO,
  LocationVO,
  LocationEntity,
  LocationTreeNodeVO,
} from '../../../db/types'

/* ==================== 转换 ==================== */

const toVO = (e: LocationEntity, parentName: string | null): LocationVO => ({
  id: e.id,
  novel_id: e.novel_id,
  name: e.name,
  parent_raw: e.parent_raw,
  parent_id: e.parent_id,
  parent_name: parentName,
  signature: e.signature,
  features: JSON.parse(e.features) as string[],
  role: e.role,
  created_at: e.created_at,
  updated_at: e.updated_at,
})

const parentNameOf = (e: LocationEntity): string | null =>
  e.parent_id === null ? null : (store.selectLocation(e.parent_id)?.name ?? null)

/* ==================== 校验 ==================== */

const assertCreateDTO = (dto: CreateLocationDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (!Number.isInteger(dto.novel_id)) throw new TypeError('novel_id 必须是整数')
  if (typeof dto.name !== 'string' || !dto.name.trim()) throw new TypeError('name 不能为空')
  if (typeof dto.signature !== 'string' || !dto.signature.trim()) {
    throw new TypeError('signature 不能为空 —— 它是这个地点唯一的记忆点')
  }
  if (dto.features !== undefined && !Array.isArray(dto.features)) {
    throw new TypeError('features 必须是数组')
  }
}

/* ==================== 名字 → id ==================== */

export const resolveLocationId = (novelId: number, raw: string): number | null => {
  if (isDemand(raw)) return null
  if (!raw.trim()) return null
  return store.selectLocationByName(novelId, raw.trim())?.id ?? null
}

/* ==================== 业务 ==================== */

export const createLocation = (dto: CreateLocationDTO): LocationVO => {
  assertCreateDTO(dto)

  const name = dto.name.trim()
  const parentRaw = normalizeRaw(dto.parent ?? '')
  const ts = now()

  const row: NewLocationRow = {
    novel_id: dto.novel_id,
    name,
    parent_raw: parentRaw,
    parent_id: resolveLocationId(dto.novel_id, parentRaw),
    signature: dto.signature.trim(),
    features: JSON.stringify(dto.features ?? []),
    role: (dto.role ?? '').trim(),
  }

  return withTransaction(() => {
    let id: number
    try {
      id = store.insertLocation(row)
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed: locations')) {
        throw new TypeError(`地点「${name}」在这本小说里已经存在 —— 同物异名要先查再写`)
      }
      throw e
    }
    // 回头补：可能早就有子地点挂在这个名字下面等着
    store.resolvePendingChildren(dto.novel_id, name, id, ts)
    const created = store.selectLocation(id)!
    return toVO(created, parentNameOf(created))
  })
}

export const getLocation = (id: number): LocationVO | null => {
  const e = store.selectLocation(id)
  return e ? toVO(e, parentNameOf(e)) : null
}

export const listLocations = (novelId: number): LocationVO[] =>
  store.selectLocationsByNovel(novelId).map((e) => toVO(e, parentNameOf(e)))

/** 有 parent_raw 但没解析出来的 —— 父地点还没建的那些 */
export const listUnresolvedParents = (novelId: number): LocationVO[] =>
  store.selectUnresolvedParents(novelId).map((e) => toVO(e, null))

/**
 * 层级树。给前端画地图用。
 *
 * parent_id 为空的（包括没解析出来的）当根节点 —— 它们至少还能看出来路，
 * 不会因为父节点缺失就从列表里消失。
 */
export const getTree = (novelId: number): LocationTreeNodeVO[] => {
  const rows = store.selectLocationsByNovel(novelId)
  const nodes = new Map<number, LocationTreeNodeVO>()
  for (const r of rows) {
    nodes.set(r.id, { id: r.id, name: r.name, signature: r.signature, parent_id: r.parent_id, children: [] })
  }
  const roots: LocationTreeNodeVO[] = []
  for (const r of rows) {
    const node = nodes.get(r.id)!
    const parent = r.parent_id === null ? undefined : nodes.get(r.parent_id)
    // 防御一下：外键理论上保证父节点存在，但真出现环 / 悬空时不该把整棵树搞崩
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export const updateLocation = (id: number, dto: UpdateLocationDTO): LocationVO | null => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  const exist = store.selectLocation(id)
  if (!exist) return null

  const patch: LocationRowPatch = {}
  if (dto.name !== undefined) patch.name = dto.name.trim()
  if (dto.signature !== undefined) patch.signature = dto.signature.trim()
  if (dto.features !== undefined) patch.features = JSON.stringify(dto.features)
  if (dto.role !== undefined) patch.role = dto.role.trim()
  if (dto.parent !== undefined) {
    const parentRaw = normalizeRaw(dto.parent)
    patch.parent_raw = parentRaw
    const parentId = resolveLocationId(exist.novel_id, parentRaw)
    // 自环是唯一要显式挡的：外键拦不住"父亲是它自己"，而那会让层级树死循环
    if (parentId === id) throw new TypeError('一个地点不能挂在它自己下面')
    patch.parent_id = parentId
  }
  patch.updated_at = now()

  store.updateLocationRow(id, patch)
  const e = store.selectLocation(id)!
  return toVO(e, parentNameOf(e))
}

/** 删除。子地点因为外键是 ON DELETE SET NULL，会被提成根节点而不是跟着消失 */
export const deleteLocation = (id: number): boolean => store.deleteLocation(id) > 0
