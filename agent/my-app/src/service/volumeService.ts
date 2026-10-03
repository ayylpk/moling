/**
 * 卷业务层。
 *
 * 一卷是"一次产出"的边界 —— 中心 agent 逐卷调 Architect，跑完一卷落一卷，
 * 所以这一层最重要的两个数是 `no`（第几卷）和 `start_chapter / end_chapter`
 * （这一卷占了全篇哪一段章号）。
 *
 * 卷本身的校验只有三条，但每条都在挡一种具体事故：
 *   · no 必须唯一且递增  —— 防止卷序错乱
 *   · start ≤ end        —— 表上 CHECK 兜底
 *   · from_state ≠ to_state —— 这两者相等意味着"这一卷没推进"，是最容易糊弄过去的一种
 */
import * as store from '../db/volumeDB'
import type { NewVolumeRow, VolumeRowPatch } from '../db/volumeDB'
import { now } from '../shared/time'
import type { CreateVolumeDTO, UpdateVolumeDTO, VolumeVO, VolumeEntity } from '../../../db/types'

/* ==================== 转换 ==================== */

const toVO = (e: VolumeEntity, hasOutline: boolean): VolumeVO => ({
  id: e.id,
  novel_id: e.novel_id,
  no: e.no,
  name: e.name,
  goal: e.goal,
  from_state: e.from_state,
  to_state: e.to_state,
  start_chapter: e.start_chapter,
  end_chapter: e.end_chapter,
  hasOutline,
  created_at: e.created_at,
  updated_at: e.updated_at,
})

/** 公开给 outlineService 复用，免得两边各拼一遍 */
export const volumeToVO = toVO

/* ==================== 校验 ==================== */

const assertCreateDTO = (dto: CreateVolumeDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (!Number.isInteger(dto.novel_id)) throw new TypeError('novel_id 必须是整数')
  for (const k of ['no', 'start_chapter', 'end_chapter'] as const) {
    if (!Number.isInteger(dto[k]) || dto[k] < 1) throw new TypeError(`${k} 必须是正整数`)
  }
  if (dto.end_chapter < dto.start_chapter) throw new TypeError('end_chapter 不能小于 start_chapter')
  if (typeof dto.name !== 'string' || !dto.name.trim()) throw new TypeError('name 不能为空')
  if (typeof dto.goal !== 'string' || !dto.goal.trim()) throw new TypeError('goal 不能为空')
  if (!dto.from_state?.trim() || !dto.to_state?.trim()) {
    throw new TypeError('from_state / to_state 都要填 —— 它们不相等才说明这一卷有推进')
  }
  if (dto.from_state.trim() === dto.to_state.trim()) {
    throw new TypeError('from_state 与 to_state 相同，这一卷等于没有推进')
  }
}

/* ==================== 业务 ==================== */

export const createVolume = (dto: CreateVolumeDTO): VolumeVO => {
  assertCreateDTO(dto)

  const row: NewVolumeRow = {
    novel_id: dto.novel_id,
    no: dto.no,
    name: dto.name.trim(),
    goal: dto.goal.trim(),
    from_state: dto.from_state.trim(),
    to_state: dto.to_state.trim(),
    start_chapter: dto.start_chapter,
    end_chapter: dto.end_chapter,
  }

  let id: number
  try {
    id = store.insertVolume(row)
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed: volumes')) {
      throw new TypeError(`第 ${dto.no} 卷已经存在`)
    }
    throw e
  }
  return toVO(store.selectVolume(id)!, false)
}

export const getVolume = (id: number): VolumeVO | null => {
  const e = store.selectVolume(id)
  if (!e) return null
  return toVO(e, store.selectOutlineVolumeFlag(e.id))
}

/** 列表。hasOutline 是现算的（outline_volumes 里有没有对应的行），不是存的 */
export const listVolumes = (novelId: number): VolumeVO[] =>
  store.selectVolumesWithOutline(novelId).map((e) => toVO(e, e.hasOutline === 1))

/** 下一卷该编几号 */
export const nextVolumeNo = (novelId: number): number => store.selectMaxVolumeNo(novelId) + 1

export const updateVolume = (id: number, dto: UpdateVolumeDTO): VolumeVO | null => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  const exist = store.selectVolume(id)
  if (!exist) return null

  const patch: VolumeRowPatch = {}
  if (dto.name !== undefined) patch.name = dto.name.trim()
  if (dto.goal !== undefined) patch.goal = dto.goal.trim()
  if (dto.from_state !== undefined) patch.from_state = dto.from_state.trim()
  if (dto.to_state !== undefined) patch.to_state = dto.to_state.trim()
  if (dto.start_chapter !== undefined) patch.start_chapter = dto.start_chapter
  if (dto.end_chapter !== undefined) patch.end_chapter = dto.end_chapter
  patch.updated_at = now()

  const start = patch.start_chapter ?? exist.start_chapter
  const end = patch.end_chapter ?? exist.end_chapter
  if (end < start) throw new TypeError('end_chapter 不能小于 start_chapter')

  const from = patch.from_state ?? exist.from_state
  const to = patch.to_state ?? exist.to_state
  if (from.trim() === to.trim()) {
    throw new TypeError('from_state 与 to_state 相同，这一卷等于没有推进')
  }

  store.updateVolumeRow(id, patch)
  const e = store.selectVolume(id)!
  return toVO(e, store.selectOutlineVolumeFlag(e.id))
}

/** 删除。大纲与章节会级联一起删 —— 这个操作会带走不少东西 */
export const deleteVolume = (id: number): boolean => store.deleteVolume(id) > 0
