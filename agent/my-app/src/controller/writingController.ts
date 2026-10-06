import type { Database } from 'bun:sqlite'

import { createCharacterRuntime, type Character } from '../db/characterDB'
import { createChapterRuntime, type ChapterOutline } from '../db/chapterDB'
import { createLocationRuntime, type Location } from '../db/locationDB'
import { createWorldRuntime, type World } from '../db/worldDB'
import { withNovel } from './withNovel'

/**
 * 写作取材 controller —— 执笔与润色两个 agent 的**资料来源**。
 *
 * 它只回答「写这一章需要知道什么」，不碰提示词、不调模型。
 *
 * ── 为什么单独一层，而不让 chapterStandalone 自己查 ──
 * 因为"这一章该给执笔看什么"本身是业务判断，不是取数：
 *
 *   ① **只给本章出场的人**。全量角色卡塞进去，writer 会在这一章里顺手把没出场的人
 *      也写进去（提一句他昨天做了什么），而他此刻不该被想起。
 *
 *   ② **只给此刻合法的字段**。角色卡里 `secret` / `reveal` / `arcEnd` 是**后面才发生的事**。
 *      第 1 章的 writer 拿到 `reveal`（"翻到旧校牌时"），就会把几十章后的底牌提前掀开 ——
 *      而且它不会报错，只会写出一章"信息量很足、后面无处可去"的正文。
 *      所以这三项**任何时候都不进 writer 的输入**；`arcStart` 给，因为它是起点不是终点。
 *
 *   ③ 地点取本章那一张，不是整个地点表。理由同上：不该出现没去过的地名。
 *
 * 这三条里任何一条松了，200000 字的书会在第一章就写坏，而且**写出来的东西读着还挺顺**，
 * 不容易当场发现 —— 所以它们写死在这个文件里，而不是交给调用方自觉传参。
 */

/** 此刻合法的角色字段。secret / reveal / arcEnd 不在其中，理由见上 */
export type CastSheet = {
  name: string
  role: string
  status: string
  immutable: string[]
  voice: string
  want: string
  cost: string
  need: string
  line: string
  flaw: string
  arcStart: string
  /** 还没解析出角色卡的出场引用（章纲里写了 NEW: 或写了错名） */
  unresolved: string[]
}

export type PlaceSheet = {
  name: string
  signature: string
  features: string[]
  role: string
  /** 父级地名（挂靠关系，写作时用来说"从哪来"） */
  parent: string
}

export type WritingBrief = {
  chapter: ChapterOutline
  world: World | null
  /** 本章出场的人，逐张卡，已裁掉"后面才发生的事" */
  cast: CastSheet[]
  place: PlaceSheet | null
  /** 供润色用的禁改清单：专名 + 世界观禁令 */
  terms: string
  forbidden: string
}

/** 一张角色卡 → writer 能看到的形状。**这里就是那道闸门，改字段清单会改变写出来的正文** */
const toCastSheet = (character: Character): CastSheet => ({
  name: character.name,
  role: character.role,
  status: character.status,
  immutable: character.immutable,
  voice: character.voice,
  want: character.want,
  cost: character.cost,
  need: character.need,
  line: character.line,
  flaw: character.flaw,
  arcStart: character.arcStart,
  unresolved: [],
})

const toPlaceSheet = (location: Location): PlaceSheet => ({
  name: location.name,
  signature: location.signature,
  features: location.features,
  role: location.role,
  parent: location.parentId === null ? location.parentRaw : '',
})

/** 把类型转成提示词里读得懂的文字。JSON 一坨对模型不友好，字段名和它后面的值要能对上 */
const prose = (label: string, value: string): string => (value.trim() ? `${label}：${value.trim()}` : '')

const renderWorld = (world: World | null): string => {
  if (!world) return '（这本书还没有世界观。）'
  const rules = (world.rules ?? []).map((rule) => {
    const parts = [prose('能力', rule.ability ?? ''), prose('代价', rule.cost ?? ''), prose('限制', rule.limit ?? '')]
    return parts.filter(Boolean).join('；')
  })
  return [
    prose('书名', world.name),
    prose('前提', world.premise),
    rules.length ? `硬规则（能力/代价/限制）：\n${rules.map((line, index) => `${index + 1}. ${line}`).join('\n')}` : '',
    world.forbidden?.length ? `禁止出现：${world.forbidden.join('、')}` : '',
    world.terms?.length ? `专名（不许改写、不许音译）：${world.terms.map((term) => term.name).join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const renderCast = (sheets: CastSheet[]): string => {
  if (sheets.length === 0) return '（本章出场名单为空。）'
  return sheets
    .map((sheet) =>
      [
        `### ${sheet.name}（${sheet.role}／${sheet.status}）`,
        sheet.immutable.length ? `不可改：${sheet.immutable.join('、')}` : '',
        prose('说话方式', sheet.voice),
        prose('想要', sheet.want),
        prose('代价', sheet.cost),
        prose('真正需要的', sheet.need),
        prose('缺陷', sheet.flaw),
        prose('口头禅／底线', sheet.line),
        prose('这条弧的起点', sheet.arcStart),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

const renderPlace = (place: PlaceSheet | null): string => {
  if (!place) return '（本章没有指定地点；不要凭空造一个新地名。）'
  return [
    `### ${place.name}${place.parent ? `（属于 ${place.parent}）` : ''}`,
    prose('样子', place.signature),
    place.features.length ? `细节：${place.features.join('；')}` : '',
    prose('戏剧功能', place.role),
  ]
    .filter(Boolean)
    .join('\n')
}

const renderChapter = (chapter: ChapterOutline): string =>
  [
    `第 ${chapter.idx} 章《${chapter.title}》`,
    prose('本章目标', chapter.goal),
    prose('本章冲突', chapter.conflict),
    prose('结尾钩子', chapter.hook),
    prose('情绪走向', chapter.emotion),
    prose('本章概要', chapter.summary),
    prose('发生地', chapter.placeRaw),
    `目标字数：${chapter.wordCountTarget}`,
  ]
    .filter(Boolean)
    .join('\n')

/**
 * 写一章需要的全部资料。
 *
 * 走 withChapterConnection 而不自己开库：generate_chapter 本来就持有一个连接，
 * 同一次写作的取材与落库应该在同一个事务视角里。
 */
export const getWritingBrief = (
  database: Database,
  novelId: number,
  chapter: ChapterOutline,
): WritingBrief => {
  const world = createWorldRuntime(database).current()
  const characters = createCharacterRuntime(database)
  const locations = createLocationRuntime(database)
  const runtime = createChapterRuntime(database)

  // 出场名单 = 章纲里点名的人。解析不到的那些原样带出去（标成 unresolved），
  // 让 writer 知道"这里本来该有个人但还没建卡" —— 它该回避，而不是自己编一个。
  const castRows = runtime.getCast(chapter.idx)
  const sheets: CastSheet[] = []
  for (const row of castRows) {
    const character = row.characterId === null ? null : characters.get(row.characterId)
    if (!character) {
      sheets.push({
        name: row.raw, role: '（未建卡）', status: 'unknown', immutable: [], voice: '',
        want: '', cost: '', need: '', line: '', flaw: '', arcStart: '',
        unresolved: [row.raw],
      })
      continue
    }
    sheets.push(toCastSheet(character))
  }

  // 地点：优先用已解析的那张卡；没解析到就退回 raw 文本（它至少是个名字）
  const place = chapter.placeId === null
    ? (chapter.placeRaw.trim() ? { name: chapter.placeRaw, signature: '', features: [], role: '', parent: '' } : null)
    : (() => {
        const found = locations.get(chapter.placeId)
        return found ? toPlaceSheet(found) : null
      })()

  return {
    chapter,
    world,
    cast: sheets,
    place,
    terms: (world?.terms ?? []).map((term) => term.name).join('、'),
    forbidden: (world?.forbidden ?? []).join('\n'),
  }
}

/** render* 的公开版本：调用方要自己拼提示词时用（不去引 writer/prompt.ts 的分段格式） */
export const renderBrief = (brief: WritingBrief): {
  world: string
  cast: string
  place: string
  chapter: string
} => ({
  world: renderWorld(brief.world),
  cast: renderCast(brief.cast),
  place: renderPlace(brief.place),
  chapter: renderChapter(brief.chapter),
})

/** 只要资料、不要渲染的轻量入口（给不需要分段的调用方） */
export const getWritingBriefByIdx = (novelId: number, chapterIdx: number): WritingBrief | null =>
  withNovel(novelId, (database) => {
    const chapter = createChapterRuntime(database).getChapter(chapterIdx)
    return chapter ? getWritingBrief(database, novelId, chapter) : null
  })
