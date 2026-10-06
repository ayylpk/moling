import { createLocationRuntime, type Location, type LocationInput, type LocationPatch } from '../db/locationDB'
import { saveLocationWithMemory } from '../service/entityService'
import { withNovel } from './withNovel'

/**
 * 地点 controller —— 一个动作一次调用。
 *
 * 建地点要顺带把之前挂不上来的子地点补上（parent_raw 对得上、parent_id 还是 NULL 的那些），
 * 这件事在 service 的 saveLocationWithMemory 里，漏掉它待办清单就永远清不掉。
 */
export const saveLocation = (novelId: number, input: LocationInput) =>
  withNovel(novelId, (database) => saveLocationWithMemory(database, novelId, input))

export const listLocations = (novelId: number): Location[] =>
  withNovel(novelId, (database) => createLocationRuntime(database).list())

export const getLocation = (novelId: number, id: number): Location | null =>
  withNovel(novelId, (database) => createLocationRuntime(database).get(id))

export const getLocationByName = (novelId: number, name: string): Location | null =>
  withNovel(novelId, (database) => createLocationRuntime(database).getByName(name))

/** 搭层级树用：某地点下的直接子地点 */
export const listChildLocations = (novelId: number, parentId: number): Location[] =>
  withNovel(novelId, (database) => createLocationRuntime(database).children(parentId))

/** 根节点 = 世界观铺的粗骨架 */
export const listRootLocations = (novelId: number): Location[] =>
  withNovel(novelId, (database) => createLocationRuntime(database).roots())

/** 有 parent_raw 但还没解析出 parent_id 的 —— 待建清单的一半 */
export const listUnresolvedLocationParents = (novelId: number): Location[] =>
  withNovel(novelId, (database) => createLocationRuntime(database).unresolvedParents())

export const updateLocation = (novelId: number, id: number, patch: LocationPatch): Location | null =>
  withNovel(novelId, (database) => createLocationRuntime(database).update(id, patch))
