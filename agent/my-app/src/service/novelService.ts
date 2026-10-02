/**
 * 小说业务层。
 *
 * 职责就三件，别的不要往里塞：
 *   1. 校验 + 补全 —— DTO 进来先检查，补默认值、补时间
 *   2. 转换 —— DTO -> Entity 行；Entity -> VO
 *   3. 组装 —— 把 db 层的原子操作拼成一个业务动作
 *
 * controller 只调这一层，不直接碰 db。
 */
import * as store from '../db/novelDB'
import type { NewNovelRow, NovelRowPatch } from '../db/novelDB'
import { SLUG_PATTERN } from '../shared/runPaths'
import { now } from '../shared/time'
import { NOVEL_STATUS } from '../../../db/types'
import type {
  CreateNovelDTO,
  UpdateNovelDTO,
  NovelVO,
  NovelEntity,
  NovelStatus,
} from '../../../db/types'

/* ==================== 转换 ==================== */

/**
 * Entity -> VO。
 *
 * novels 表没有 JSON 列，所以这里是恒等变换 —— 不像 worlds 那样要 parse 五个数组。
 * 留着这个函数是为了跟其它 domain 的形态一致：哪天加了 JSON 列，
 * 改这一处就够了，调用方不用动。
 */
const toVO = (e: NovelEntity): NovelVO => ({ ...e })

/** DTO -> Entity 行：补默认值，去掉首尾空白 */
const toRow = (dto: CreateNovelDTO): NewNovelRow => ({
  slug: dto.slug.trim(),
  title: dto.title.trim(),
  genre: (dto.genre ?? '').trim(),
  style: (dto.style ?? '').trim(),
  status: dto.status ?? 'draft',
})

/* ==================== 校验 ==================== */
// TS 的 interface 编译后就没了，运行时传错照样能跑。
// 真检查放这一层 —— 这是 service 的活儿，db 层不管。

/** slug 要当磁盘目录名用，形状必须卡死。不卡的话带 ../ 的 slug 会写到项目外面 */
const assertSlug = (slug: unknown): string => {
  if (typeof slug !== 'string' || !slug.trim()) throw new TypeError('slug 不能为空')
  const s = slug.trim()
  if (!SLUG_PATTERN.test(s)) {
    throw new TypeError('slug 只允许小写字母、数字、连字符，且不能以连字符开头，最长 48 位')
  }
  return s
}

const assertStatus = (status: unknown): NovelStatus => {
  if (!NOVEL_STATUS.includes(status as NovelStatus)) {
    throw new TypeError(`status 只能是 ${NOVEL_STATUS.join(' / ')}`)
  }
  return status as NovelStatus
}

const assertCreateDTO = (dto: CreateNovelDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  assertSlug(dto.slug)
  if (typeof dto.title !== 'string' || !dto.title.trim()) throw new TypeError('title 不能为空')
  if (dto.status !== undefined) assertStatus(dto.status)
}

const assertUpdateDTO = (dto: UpdateNovelDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (dto.slug !== undefined) assertSlug(dto.slug)
  if (dto.title !== undefined && (typeof dto.title !== 'string' || !dto.title.trim())) {
    throw new TypeError('title 不能是空字符串')
  }
  if (dto.status !== undefined) assertStatus(dto.status)
}

/* ==================== 业务 ==================== */

/** 新建，返回建好的完整数据 */
export const createNovel = (dto: CreateNovelDTO): NovelVO => {
  assertCreateDTO(dto)
  let id: number
  try {
    id = store.insertNovel(toRow(dto))
  } catch (e) {
    // slug 是 UNIQUE。撞了的话把数据库的英文报错翻成调用方能懂的一句话
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed: novels.slug')) {
      throw new TypeError(`slug「${dto.slug.trim()}」已被占用`)
    }
    throw e
  }
  return toVO(store.selectNovel(id)!)
}

export const getNovel = (id: number): NovelVO | null => {
  const e = store.selectNovel(id)
  return e ? toVO(e) : null
}

export const getNovelBySlug = (slug: string): NovelVO | null => {
  const e = store.selectNovelBySlug(slug)
  return e ? toVO(e) : null
}

export const listNovels = (status?: NovelStatus): NovelVO[] => {
  const rows = status === undefined ? store.selectNovels() : store.selectNovelsByStatus(status)
  return rows.map(toVO)
}

/** 更新：只改传了的字段，返回更新后的完整数据；id 不存在返回 null */
export const updateNovel = (id: number, dto: UpdateNovelDTO): NovelVO | null => {
  assertUpdateDTO(dto)

  const patch: NovelRowPatch = {}
  if (dto.slug !== undefined) patch.slug = dto.slug.trim()
  if (dto.title !== undefined) patch.title = dto.title.trim()
  if (dto.genre !== undefined) patch.genre = dto.genre.trim()
  if (dto.style !== undefined) patch.style = dto.style.trim()
  if (dto.status !== undefined) patch.status = dto.status
  // 时间在这一层补，不靠数据库默认值 —— 默认值只在 INSERT 时生效，UPDATE 不触发
  patch.updated_at = now()

  try {
    store.updateNovelRow(id, patch)
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed: novels.slug')) {
      throw new TypeError(`slug「${dto.slug?.trim()}」已被占用`)
    }
    throw e
  }
  const e = store.selectNovel(id)
  return e ? toVO(e) : null
}

/** 删除，返回是否真的删掉了（false = 本来就没这条） */
export const deleteNovel = (id: number): boolean => store.deleteNovel(id) > 0
