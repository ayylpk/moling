import { createCharacterRuntime, type Character, type CharacterBrief, type CharacterInput, type CharacterPatch } from '../db/characterDB'
import { rememberCharacter, saveCharacterWithMemory } from '../service/entityService'
import { withNovel } from './withNovel'

/**
 * 角色 controller —— 一个动作一次调用。
 *
 * 建卡要顺带做两件事，都不在这里做：把章纲里同名未解析的出场记录补上、发记忆。
 * 那两件是「建卡"这件事」的一部分，漏掉就是同一个动作有两种副作用，
 * 所以它们绑在 service 的 saveCharacterWithMemory 里，由这里原样转出。
 */
export const saveCharacter = (novelId: number, input: CharacterInput) =>
  withNovel(novelId, (database) => saveCharacterWithMemory(database, novelId, input))

export const getCharacter = (novelId: number, id: number): Character | null =>
  withNovel(novelId, (database) => createCharacterRuntime(database).get(id))

export const getCharacterByName = (novelId: number, name: string): Character | null =>
  withNovel(novelId, (database) => createCharacterRuntime(database).getByName(name))

export const listCharacters = (novelId: number): Character[] =>
  withNovel(novelId, (database) => createCharacterRuntime(database).list())

/** 索引：只回名字/id/定位。派活前先看它，别用全文去喂子 agent */
export const listCharacterBriefs = (novelId: number): CharacterBrief[] =>
  withNovel(novelId, (database) => createCharacterRuntime(database).briefs())

/** 改卡也是一次落库：不发记忆的话，"改完这条事实"在记忆里就不存在 */
export const updateCharacter = (novelId: number, id: number, patch: CharacterPatch): Character | null =>
  withNovel(novelId, (database) => {
    const updated = createCharacterRuntime(database).update(id, patch)
    if (updated) rememberCharacter(novelId, updated)
    return updated
  })
