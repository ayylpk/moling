/**
 * 角色业务层。
 *
 * 两件事跟别处不一样，都跟"关系网是拆表的"有关：
 *
 *   1. **建卡时要把 relations 里的名字解析成 id**。agent 写出来的只能是名字，
 *      而库里存的是外键。解析不到就留 NULL —— 那个人可能真的还没建。
 *   2. **建完一张卡要回头补解析**。因为别的卡可能早就提到过这个名字了
 *      （关系里写了、章纲 cast 里写了），当时解析不出来的那些，现在能补上。
 *      这就是"待建清单"自我消解的机制。
 */
import * as store from '../db/characterDB'
import type { NewCharacterRow, CharacterRowPatch } from '../db/characterDB'
import * as chapterStore from '../db/chapterDB'
import { withTransaction } from '../db/createDB'
import { now } from '../shared/time'
import { isDemand, normalizeRaw } from '../shared/demand'
import { CHARACTER_ROLE, CHARACTER_STATUS, CHARACTER_SOURCE } from '../../../db/types'
import type {
  CreateCharacterDTO,
  UpdateCharacterDTO,
  CharacterQueryDTO,
  CharacterVO,
  CharacterBriefVO,
  CharacterEntity,
  CharacterRelationEntity,
} from '../../../db/types'

/* ==================== 转换 ==================== */

const relationToVO = (r: CharacterRelationEntity) => ({
  id: r.id,
  from_character_id: r.from_character_id,
  to_raw: r.to_raw,
  to_character_id: r.to_character_id,
  attitude: r.attitude,
  resolved_at: r.resolved_at,
})

const toVO = (e: CharacterEntity, relations: CharacterRelationEntity[]): CharacterVO => ({
  id: e.id,
  novel_id: e.novel_id,
  name: e.name,
  role: e.role,
  immutable: JSON.parse(e.immutable) as string[],
  voice: e.voice,
  want: e.want,
  cost: e.cost,
  need: e.need,
  secret: e.secret,
  reveal: e.reveal,
  line: e.line,
  flaw: e.flaw,
  // arc 在库里是两列，出去时拼回 agent schema 的那个形状 ——
  // 库里拆开是为了能用 SQL 比"起点 ≠ 终点"，出去还原是为了调用方好用
  arc: { start: e.arc_start, end: e.arc_end },
  status: e.status,
  source: e.source,
  relations: relations.map(relationToVO),
  created_at: e.created_at,
  updated_at: e.updated_at,
})

/* ==================== 校验 ==================== */

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (!allowed.includes(value as T)) throw new TypeError(`${field} 只能是 ${allowed.join(' / ')}`)
  return value as T
}

const assertCreateDTO = (dto: CreateCharacterDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (!Number.isInteger(dto.novel_id)) throw new TypeError('novel_id 必须是整数')
  if (typeof dto.name !== 'string' || !dto.name.trim()) throw new TypeError('name 不能为空')
  oneOf(dto.role, CHARACTER_ROLE, 'role')
  if (dto.status !== undefined) oneOf(dto.status, CHARACTER_STATUS, 'status')
  if (dto.source !== undefined) oneOf(dto.source, CHARACTER_SOURCE, 'source')
  if (dto.immutable !== undefined && !Array.isArray(dto.immutable)) {
    throw new TypeError('immutable 必须是数组')
  }
  if (dto.relations !== undefined) {
    if (!Array.isArray(dto.relations)) throw new TypeError('relations 必须是数组')
    for (const r of dto.relations) {
      if (!r || typeof r.raw !== 'string' || !r.raw.trim()) {
        throw new TypeError('relations[].raw 不能为空')
      }
    }
  }
}

/* ==================== 名字 → id ==================== */

/**
 * 把一个名字解析成角色 id。
 *
 * 导出它是因为 Chapter / ActorDecision 那边也要用同一套规则 ——
 * 三处各写一遍迟早会有一处忘了判 NEW: 前缀。
 */
export const resolveCharacterId = (novelId: number, raw: string): number | null => {
  if (isDemand(raw)) return null
  return store.selectCharacterByName(novelId, raw.trim())?.id ?? null
}

/* ==================== 业务 ==================== */

/**
 * 建一张卡。关系网和卡在**一个事务**里写完 ——
 * 否则失败时会留下"卡有了、关系没了"的半成品。
 */
export const createCharacter = (dto: CreateCharacterDTO): CharacterVO => {
  assertCreateDTO(dto)

  const name = dto.name.trim()
  const ts = now()
  const row: NewCharacterRow = {
    novel_id: dto.novel_id,
    name,
    role: dto.role,
    immutable: JSON.stringify(dto.immutable ?? []),
    voice: (dto.voice ?? '').trim(),
    want: (dto.want ?? '').trim(),
    cost: (dto.cost ?? '').trim(),
    need: (dto.need ?? '').trim(),
    secret: (dto.secret ?? '').trim(),
    reveal: (dto.reveal ?? '').trim(),
    line: (dto.line ?? '').trim(),
    flaw: (dto.flaw ?? '').trim(),
    arc_start: (dto.arc?.start ?? '').trim(),
    arc_end: (dto.arc?.end ?? '').trim(),
    status: dto.status ?? 'alive',
    source: dto.source ?? 'agent',
  }

  return withTransaction(() => {
    let id: number
    try {
      id = store.insertCharacter(row)
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed: characters')) {
        throw new TypeError(`角色「${name}」在这本小说里已经存在`)
      }
      throw e
    }

    for (const rel of dto.relations ?? []) {
      const raw = normalizeRaw(rel.raw)
      const toId = resolveCharacterId(dto.novel_id, raw)
      store.insertRelation({
        novel_id: dto.novel_id,
        from_character_id: id,
        to_raw: raw,
        to_character_id: toId,
        attitude: (rel.attitude ?? '').trim(),
        resolved_at: toId === null ? null : ts,
      })
    }

    // 回头补：别的卡 / 章纲可能早就提到过这个名字
    store.resolvePendingRelations(dto.novel_id, name, id, ts)
    chapterStore.resolvePendingCast(dto.novel_id, name, id, ts)

    return toVO(store.selectCharacter(id)!, store.selectRelationsByFrom(id))
  })
}

export const getCharacter = (id: number): CharacterVO | null => {
  const e = store.selectCharacter(id)
  return e ? toVO(e, store.selectRelationsByFrom(id)) : null
}

export const listCharacters = (novelId: number, query: CharacterQueryDTO = {}): CharacterBriefVO[] => {
  if (query.role !== undefined) oneOf(query.role, CHARACTER_ROLE, 'role')
  if (query.status !== undefined) oneOf(query.status, CHARACTER_STATUS, 'status')
  return store.selectCharacterBriefs(novelId, { role: query.role, status: query.status })
}

/** 关系网里指向了不存在角色的那些条 —— 待建清单的其中一半 */
export const listUnresolvedRelations = (novelId: number) =>
  store.selectUnresolvedRelations(novelId).map(relationToVO)

export const updateCharacter = (id: number, dto: UpdateCharacterDTO): CharacterVO | null => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  const exist = store.selectCharacter(id)
  if (!exist) return null

  if (dto.role !== undefined) oneOf(dto.role, CHARACTER_ROLE, 'role')
  if (dto.status !== undefined) oneOf(dto.status, CHARACTER_STATUS, 'status')
  if (dto.source !== undefined) oneOf(dto.source, CHARACTER_SOURCE, 'source')

  const patch: CharacterRowPatch = {}
  if (dto.name !== undefined) patch.name = dto.name.trim()
  if (dto.role !== undefined) patch.role = dto.role
  if (dto.immutable !== undefined) patch.immutable = JSON.stringify(dto.immutable)
  if (dto.voice !== undefined) patch.voice = dto.voice.trim()
  if (dto.want !== undefined) patch.want = dto.want.trim()
  if (dto.cost !== undefined) patch.cost = dto.cost.trim()
  if (dto.need !== undefined) patch.need = dto.need.trim()
  if (dto.secret !== undefined) patch.secret = dto.secret.trim()
  if (dto.reveal !== undefined) patch.reveal = dto.reveal.trim()
  if (dto.line !== undefined) patch.line = dto.line.trim()
  if (dto.flaw !== undefined) patch.flaw = dto.flaw.trim()
  if (dto.arc !== undefined) {
    patch.arc_start = dto.arc.start.trim()
    patch.arc_end = dto.arc.end.trim()
  }
  if (dto.status !== undefined) patch.status = dto.status
  if (dto.source !== undefined) patch.source = dto.source
  patch.updated_at = now()

  store.updateCharacterRow(id, patch)

  // 改了名字的话，别的卡里指向旧名字的未解析关系还是解析不出来 ——
  // 这里不做自动改名，那属于"顺手改了一处忘了一处"，交给调用方显式处理。
  const e = store.selectCharacter(id)!
  return toVO(e, store.selectRelationsByFrom(id))
}

/** 重建这张卡的关系网。传空数组就是清空 */
export const replaceRelations = (
  id: number,
  relations: { raw: string; attitude: string }[],
): CharacterVO | null => {
  const exist = store.selectCharacter(id)
  if (!exist) return null
  const ts = now()

  return withTransaction(() => {
    store.deleteRelationsByFrom(id)
    for (const rel of relations) {
      const raw = normalizeRaw(rel.raw)
      const toId = resolveCharacterId(exist.novel_id, raw)
      store.insertRelation({
        novel_id: exist.novel_id,
        from_character_id: id,
        to_raw: raw,
        to_character_id: toId,
        attitude: (rel.attitude ?? '').trim(),
        resolved_at: toId === null ? null : ts,
      })
    }
    return toVO(store.selectCharacter(id)!, store.selectRelationsByFrom(id))
  })
}

/** 删除。关系网跟着级联删；别的卡指向它的关系会退回未解析态（ON DELETE SET NULL） */
export const deleteCharacter = (id: number): boolean => store.deleteCharacter(id) > 0
