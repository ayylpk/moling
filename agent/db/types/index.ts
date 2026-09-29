/**
 * agent/db/types —— 所有跨层共享的类型。
 *
 * 三个文件各管一层，别混着写：
 *   entity.ts  与表一一对应（库里长什么样）
 *   dto.ts     调用方传进来（入口）
 *   vo.ts      返回出去（出口）
 *
 * 统一从本文件导出，外部一律 import from '.../db/types'，
 * 不要直接深链到 './types/entity'，以后拆文件不用改调用方。
 */
export * from './entity'
export * from './dto'
export * from './vo'
