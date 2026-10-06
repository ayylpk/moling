import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from './connection'
import { createOutlineRuntime, type AnchorInput } from './outlineDB'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

const anchor: AnchorInput = {
  logline: '重来一次，她要救回所有人',
  theme: '赎',
  coreConflict: '他知道结局，却改不动开始',
  endingDirection: '与自己和解',
  structureType: 'three-act',
  mainPlot: { id: 'm1', name: '主线' },
  subplots: [],
}

describe('center outline sqlite runtime', () => {
  test('writes the anchor once and reports drift instead of overwriting', () => {
    const database = setup()
    const runtime = createOutlineRuntime(database)

    const first = runtime.saveAnchor(anchor)
    expect(first).toMatchObject({ drift: false, written: true })
    expect(runtime.currentAnchor()).toMatchObject({ logline: '重来一次，她要救回所有人', structureType: 'three-act' })

    // 后续卷提交了改过的锚点：报漂移，但不覆盖已定稿的那份
    const changed = runtime.saveAnchor({ ...anchor, logline: '改掉了' })
    expect(changed).toMatchObject({ drift: true, written: false })
    expect(runtime.currentAnchor()?.logline).toBe('重来一次，她要救回所有人')

    // 键序不同不该算漂移（误报比不报更糟）
    expect(runtime.checkAnchorDrift({ ...anchor, mainPlot: { name: '主线', id: 'm1' } })).toEqual({ drift: false, hasAnchor: true })
    database.close()
  })

  test('keeps each volume snapshot and flags the drifted one', () => {
    const database = setup()
    const runtime = createOutlineRuntime(database)
    runtime.saveAnchor(anchor)
    database.query(`INSERT INTO volumes (no, name, start_chapter, end_chapter) VALUES (1, '第一卷', 1, 2)`).run()
    database.query(`INSERT INTO volumes (no, name, start_chapter, end_chapter) VALUES (2, '第二卷', 3, 4)`).run()

    const ok = runtime.saveVolumeOutline({ volumeId: 1, structureType: 'three-act', acts: [{ id: 'a1' }], anchorSnapshot: anchor })
    expect(ok.drift).toBe(false)
    expect(ok.outline).toMatchObject({ volumeId: 1, structureType: 'three-act' })
    expect(runtime.listDriftedVolumeIds()).toEqual([])

    // 第二卷把结局方向改了 → 快照留下证据
    const drifted = runtime.saveVolumeOutline({ volumeId: 2, anchorSnapshot: { ...anchor, endingDirection: '彻底决裂' } })
    expect(drifted.drift).toBe(true)
    expect(runtime.listVolumeOutlines()).toHaveLength(2)
    expect(runtime.listDriftedVolumeIds()).toEqual([2])

    // 同一卷重跑是 UPSERT，不会堆出两条
    const again = runtime.saveVolumeOutline({ volumeId: 1, structureType: 'four-act', anchorSnapshot: anchor })
    expect(again.outline.structureType).toBe('four-act')
    expect(runtime.listVolumeOutlines()).toHaveLength(2)
    database.close()
  })

  test('validates the anchor before writing', () => {
    const database = setup()
    const runtime = createOutlineRuntime(database)
    expect(() => runtime.saveAnchor({ ...anchor, logline: ' ' })).toThrow('logline 不能为空')
    expect(runtime.currentAnchor()).toBeNull()
    database.close()
  })
})
