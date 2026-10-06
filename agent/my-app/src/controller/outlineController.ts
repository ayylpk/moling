import { createChapterRuntime } from '../db/chapterDB'
import { createOutlineRuntime, type AnchorInput, type VolumeOutlineInput } from '../db/outlineDB'
import { rememberVolumeOutline, saveVolumeOutlineWithMemory, type VolumeOutlineBundle } from '../service/entityService'
import { withNovel } from './withNovel'

/**
 * 大纲 controller —— 一个动作一次调用。
 *
 * 落一卷（卷 + 锚点 + 卷纲）的顺序有意义，绑在 service 里：先写锚点再写卷纲，
 * 第一卷的快照才和锚点一致、不误报漂移。这里不拆开它。
 */
export const saveVolumeOutline = (novelId: number, bundle: VolumeOutlineBundle) =>
  withNovel(novelId, (database) => saveVolumeOutlineWithMemory(database, novelId, bundle))

/** 大纲索引与漂移检查：全篇锚点 + 每卷的卷纲 + 漂移的卷号 */
export const readOutline = (novelId: number) =>
  withNovel(novelId, (database) => {
    const runtime = createOutlineRuntime(database)
    return {
      anchor: runtime.currentAnchor(),
      volumeOutlines: runtime.listVolumeOutlines(),
      driftedVolumeIds: runtime.listDriftedVolumeIds(),
    }
  })

/**
 * 只写锚点与卷纲，**不建卷**（卷已存在时用）。
 *
 * 一次要写两张表就包一个事务：半成品的锚点比没锚点更难查。
 * 写完照样发记忆 —— 它是"落了一条卷纲"这件事，不因为走的不是工具层就免掉。
 */
export const saveAnchorWithOutline = (
  novelId: number,
  input: { anchor?: AnchorInput; volumeOutline?: VolumeOutlineInput },
) =>
  withNovel(novelId, (database) => {
    const runtime = createOutlineRuntime(database)
    const result = database.transaction(() => ({
      anchor: input.anchor ? runtime.saveAnchor(input.anchor) : null,
      outline: input.volumeOutline ? runtime.saveVolumeOutline(input.volumeOutline) : null,
    }))()

    if (result.outline) {
      const outline = result.outline.outline
      const volume = createChapterRuntime(database).listVolumes().find((item) => item.id === outline.volumeId)
      rememberVolumeOutline(novelId, {
        volumeId: outline.volumeId,
        volumeName: volume?.name ?? `第${outline.volumeId}卷`,
        volume: { id: outline.volumeId, name: volume?.name ?? '', no: volume?.no },
        direction: input.anchor,
        structureType: outline.structureType,
        acts: outline.acts,
      })
    }
    return result
  })

/** 某一卷的卷纲全文（幕 / 转折点 / 节奏 / 约束），排这一卷时才需要 */
export const getVolumeOutline = (novelId: number, volumeId: number) =>
  withNovel(novelId, (database) => createOutlineRuntime(database).getVolumeOutline(volumeId))

/** 卷列表，hasOutline 现算 —— 卷表上没有这一列，存副本就会和事实不同步 */
export const listVolumes = (novelId: number) =>
  withNovel(novelId, (database) => {
    const outlined = new Set(createOutlineRuntime(database).listVolumeOutlines().map((item) => item.volumeId))
    return createChapterRuntime(database)
      .listVolumes()
      .map((volume) => ({ ...volume, hasOutline: outlined.has(volume.id) }))
  })
