import { createWorldRuntime, type World, type WorldInput } from '../db/worldDB'
import { saveWorldWithMemory } from '../service/entityService'
import { withNovel } from './withNovel'

/**
 * 世界观 controller —— 一个动作一次调用。
 *
 * 写：saveWorld（骨架物化 + 记忆都在 service 里完成）
 * 读：currentWorld / listWorlds
 */
export const saveWorld = (novelId: number, input: WorldInput): World =>
  withNovel(novelId, (database) => saveWorldWithMemory(database, novelId, input))

export const currentWorld = (novelId: number): World | null =>
  withNovel(novelId, (database) => createWorldRuntime(database).current())

export const listWorlds = (novelId: number): World[] =>
  withNovel(novelId, (database) => createWorldRuntime(database).list())
