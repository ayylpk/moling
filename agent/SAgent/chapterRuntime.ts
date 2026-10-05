import type { Database } from 'bun:sqlite'

/**
 * 章节 runtime —— per-novel 库的「卷 / 章纲 / 出场角色 / 正文 / 任务」写读入口。
 *
 * ── 为什么这五样放一个文件 ──
 * 它们几乎总是一起读写：存一卷大纲 = 写 volumes + 每章的 chapters + chapter_cast；
 * 写一章正文 = UPSERT chapter_texts。拆开只会让调用方每次都拼三四个 runtime。
 *
 * ── 卷内章号，不是全局章号 ──
 * 保存章纲时按 **(volume_id, idx)** 找已有行，不按 (idx) 找。
 * 按全局章号找的话，第二卷声明"第 3 章"会**把第一卷的第 3 章悄悄挪到自己名下** ——
 * 那不叫报错，那叫把数据挪走了。按卷内找之后，跨卷撞号会走到 INSERT 并撞上
 * UNIQUE(idx)，直接失败（invalidate 而不是静默改），这才是我们要的。
 *
 * ── raw + 可空 id（和 locations.parent 同一套形态）──
 * chapter_cast.raw 存章纲里原样写的名字，character_id 是解析结果。
 * 解析不到 = 那个人还没建卡，是**待办状态**，靠 resolveCast 回头补。
 * **`NEW:` 前缀永不解析**：它描述需求（"一个能撞见仇人的角色"），不是名字，
 * 拿去查表可能撞到一个碰巧同名的角色。判定只在 isDemand 一处。
 *
 * ── chapter_texts / generation_tasks 维持原样 ──
 * 一章两行（draft/final）封顶、UPSERT 覆盖不堆历史；任务按
 * (stage, target_key) 去重、claim 的 skip/run 语义不变。这里不重写它们。
 */
export type ChapterStage = 'world' | 'character' | 'location' | 'outline' | 'chapter' | 'polish'
export type TextStage = 'draft' | 'final'

export type VolumeInput = {
  /** 第几卷，从 1 开始 */
  no: number
  name: string
  goal?: string
  fromState?: string
  toState?: string
  startChapter: number
  endChapter: number
}

export type Volume = {
  id: number
  no: number
  name: string
  goal: string
  fromState: string
  toState: string
  startChapter: number
  endChapter: number
  createdAt: string
  updatedAt: string
}

/** 章纲入参，对着 Architect 的 ChapterOutline */
export type ChapterOutlineInput = {
  index: number
  title: string
  goal?: string
  conflict?: string
  hook?: string
  emotion?: string
  summary?: string
  /** 本章地点：已有地名，或 `NEW:戏剧功能` */
  place?: string
  /** 出场角色：已有名字，或 `NEW:戏剧功能` */
  characters?: string[]
  wordCountTarget?: number
}

export type ChapterOutline = {
  id: number
  volumeId: number
  idx: number
  title: string
  goal: string
  conflict: string
  hook: string
  emotion: string
  summary: string
  placeRaw: string
  placeId: number | null
  wordCountTarget: number
}

/** 改一条章纲。按 id 改（前端 PUT /api/chapters/:id 用），不是按「卷内章号」 */
export type ChapterOutlinePatch = {
  title?: string
  goal?: string
  conflict?: string
  hook?: string
  emotion?: string
  summary?: string
  /** 改地点：写已有地名或 `NEW:戏剧功能`；会顺带重解析 place_id */
  place?: string
  wordCountTarget?: number
}

export type ChapterCast = {
  id: number
  chapterId: number
  raw: string
  characterId: number | null
  resolvedAt: string | null
  createdAt: string
}

/** 章纲里声明了 `NEW:` 但还没兑现的东西 —— 中心 agent 的待办清单 */
export type PendingDemand = {
  kind: 'character' | 'location'
  chapterIdx: number
  raw: string
  /** `NEW:` 后面那段话，正好是 Character / Location agent 的 need */
  need: string
}

export type ChapterText = {
  id: number
  chapterId: number
  stage: TextStage
  text: string
  summary: string
  endsWith: string
  polishReport: unknown
}
export type GenerationTask = {
  id: number
  stage: ChapterStage
  targetKey: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'stale'
  attempt: number
  inputHash: string
  error: string
}

type TaskRow = {
  id: number
  stage: ChapterStage
  target_key: string
  status: GenerationTask['status']
  attempt: number
  input_hash: string
  error: string
}

/* ==================== NEW: 约定（判定只此一处） ==================== */

const NEW_PREFIX = 'NEW:'

/** 是不是一个未兑现的需求。大小写不敏感，容忍前后空格 */
export const isDemand = (raw: string): boolean => raw.trim().toUpperCase().startsWith(NEW_PREFIX)

/** 取出 `NEW:` 后面那段话（下游 agent 的 need）。不是需求则返回空串 */
export const demandNeed = (raw: string): string =>
  isDemand(raw) ? raw.trim().slice(NEW_PREFIX.length).trim() : ''

/** 规范化一个 raw 值：去首尾空白，NEW: 前缀统一成大写 */
export const normalizeRaw = (raw: string): string => {
  const t = raw.trim()
  return isDemand(t) ? NEW_PREFIX + demandNeed(t) : t
}

export const createChapterRuntime = (database: Database) => {
  const readTask = (id: number): GenerationTask | null => {
    const row = database.query('SELECT id, stage, target_key, status, attempt, input_hash, error FROM generation_tasks WHERE id = ?').get(id) as TaskRow | null
    return row ? toTask(row) : null
  }

  const readTaskByKey = (stage: ChapterStage, targetKey: string): GenerationTask | null => {
    const row = database.query('SELECT id, stage, target_key, status, attempt, input_hash, error FROM generation_tasks WHERE stage = ? AND target_key = ?').get(stage, targetKey) as TaskRow | null
    return row ? toTask(row) : null
  }

  const readChapterRow = (idx: number): Record<string, unknown> | null =>
    (database.query('SELECT * FROM chapters WHERE idx = ?').get(idx) as Record<string, unknown> | null)

  /** 按主键取行。HTTP 的 /api/chapters/:id 走的是 id，不是章号 */
  const readChapterRowById = (id: number): Record<string, unknown> | null =>
    (database.query('SELECT * FROM chapters WHERE id = ?').get(id) as Record<string, unknown> | null)

  const readChapterById = (id: number): ChapterOutline | null => {
    const row = readChapterRowById(id)
    return row ? toChapter(row) : null
  }

  /** 章级：名字 → id，精确相等。`NEW:` 不问、也不存在 */
  const characterIdByName = (name: string): number | null => {
    if (!name || isDemand(name)) return null
    const row = database.query('SELECT id FROM characters WHERE name = ?').get(name.trim()) as { id: number } | null
    return row ? Number(row.id) : null
  }

  /** 地点名 → id，精确相等。`NEW:` 不问 */
  const locationIdByName = (name: string): number | null => {
    if (!name || isDemand(name)) return null
    const row = database.query('SELECT id FROM locations WHERE name = ?').get(name.trim()) as { id: number } | null
    return row ? Number(row.id) : null
  }

  const readVolumeRow = (id: number): Record<string, unknown> | null =>
    (database.query('SELECT * FROM volumes WHERE id = ?').get(id) as Record<string, unknown> | null)

  /* ---- 写：卷 ---- */

  /**
   * 建 / 改一卷。按卷号 UPSERT —— 同一卷重跑是安全的，不会堆出两条第 1 卷。
   * （卷表没有 status 列：这一卷到哪一步，看 outline_volumes 在不在、正文有没有 final。）
   */
  const createVolume = (input: VolumeInput): { volume: Volume; created: boolean } => {
    assertVolume(input)
    const existing = database.query('SELECT id FROM volumes WHERE no = ?').get(input.no) as { id: number } | null
    if (existing) {
      database
        .query(
          `UPDATE volumes SET name = ?, goal = ?, from_state = ?, to_state = ?, start_chapter = ?, end_chapter = ?,
             updated_at = datetime('now','localtime') WHERE id = ?`,
        )
        .run(input.name.trim(), input.goal ?? '', input.fromState ?? '', input.toState ?? '', input.startChapter, input.endChapter, existing.id)
      return { volume: toVolume(readVolumeRow(existing.id)!), created: false }
    }
    const result = database
      .query(`INSERT INTO volumes (no, name, goal, from_state, to_state, start_chapter, end_chapter) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.no, input.name.trim(), input.goal ?? '', input.fromState ?? '', input.toState ?? '', input.startChapter, input.endChapter)
    return { volume: toVolume(readVolumeRow(Number(result.lastInsertRowid))!), created: true }
  }

  /* ---- 写：章纲 + 出场角色（一个事务） ---- */

  /**
   * 存一章章纲，并顺带重建这一章的出场名单（chapter_cast）。
   *
   * 用事务包住是因为两张表要么一起成、要么一起不成 —— 章纲落库了但名单没落，
   * 下游会以为"这章没有角色"，那是查不出来的错。
   */
  const saveChapterOutline = (volumeId: number, input: ChapterOutlineInput): { chapter: ChapterOutline; created: boolean; cast: ChapterCast[] } => {
    if (!Number.isInteger(volumeId)) throw new TypeError('volumeId 必须是整数')
    assertChapter(input)
    if (!readVolumeRow(volumeId)) throw new TypeError(`volume_id=${volumeId} 不存在，先建卷`)

    return database.transaction(() => {
      const placeRaw = (input.place ?? '').trim()
      const placeId = locationIdByName(placeRaw)
      const target = input.wordCountTarget ?? 3000
      const existing = database.query('SELECT id FROM chapters WHERE volume_id = ? AND idx = ?').get(volumeId, input.index) as { id: number } | null

      let chapterId: number
      let created: boolean
      if (existing) {
        database
          .query(
            `UPDATE chapters SET title = ?, goal = ?, conflict = ?, hook = ?, emotion = ?, summary = ?,
               place_raw = ?, place_id = ?, word_count_target = ?, updated_at = datetime('now','localtime')
             WHERE id = ?`,
          )
          .run(
            input.title.trim(),
            input.goal ?? '',
            input.conflict ?? '',
            input.hook ?? '',
            input.emotion ?? '',
            input.summary ?? '',
            placeRaw,
            placeId,
            target,
            existing.id,
          )
        chapterId = existing.id
        created = false
      } else {
        try {
          const result = database
            .query(
              `INSERT INTO chapters (volume_id, idx, title, goal, conflict, hook, emotion, summary, place_raw, place_id, word_count_target)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              volumeId,
              input.index,
              input.title.trim(),
              input.goal ?? '',
              input.conflict ?? '',
              input.hook ?? '',
              input.emotion ?? '',
              input.summary ?? '',
              placeRaw,
              placeId,
              target,
            )
          chapterId = Number(result.lastInsertRowid)
        } catch (error) {
          // 跨卷撞号：idx 是全篇唯一的。把 SQLite 的报错翻译成人话
          throw new TypeError(
            `第 ${input.index} 章已属于别的卷（章号全篇连续、不从 1 重开）。` +
              `原始错误：${error instanceof Error ? error.message : String(error)}`,
          )
        }
        created = true
      }

      const cast = writeCast(chapterId, input.characters ?? [])
      return { chapter: toChapter(readChapterRow(input.index)!), created, cast }
    })()
  }

  /** 重建一章的出场名单：先清后插。raw 去重，NEW: 统一成大写前缀 */
  const writeCast = (chapterId: number, raws: string[]): ChapterCast[] => {
    database.query('DELETE FROM chapter_cast WHERE chapter_id = ?').run(chapterId)
    const seen = new Set<string>()
    for (const raw of raws) {
      const normalized = normalizeRaw(String(raw ?? ''))
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      database
        .query(`INSERT INTO chapter_cast (chapter_id, raw, character_id) VALUES (?, ?, ?)`)
        .run(chapterId, normalized, characterIdByName(normalized))
    }
    return getCastByChapterId(chapterId)
  }

  const getCastByChapterId = (chapterId: number): ChapterCast[] =>
    (database.query('SELECT * FROM chapter_cast WHERE chapter_id = ? ORDER BY id').all(chapterId) as Array<Record<string, unknown>>).map(toCast)

  const readChapterRowBy = (idx: number): Record<string, unknown> | null => readChapterRow(idx)

  return {
    /* ==================== 卷 ==================== */
    createVolume,
    getVolume(id: number): Volume | null {
      const row = readVolumeRow(id)
      return row ? toVolume(row) : null
    },
    getVolumeByNo(no: number): Volume | null {
      const row = database.query('SELECT * FROM volumes WHERE no = ?').get(no) as Record<string, unknown> | null
      return row ? toVolume(row) : null
    },
    listVolumes(): Volume[] {
      return (database.query('SELECT * FROM volumes ORDER BY no').all() as Array<Record<string, unknown>>).map(toVolume)
    },
    /** 已有最大卷号，一卷都没有时返回 0 —— 下一卷的编号靠它算 */
    maxVolumeNo(): number {
      return Number((database.query('SELECT coalesce(max(no), 0) AS v FROM volumes').get() as { v: number }).v)
    },

    /* ==================== 章 ==================== */
    saveChapterOutline,
    getChapter(idx: number): ChapterOutline | null {
      const row = readChapterRow(idx)
      return row ? toChapter(row) : null
    },
    /** 按主键取一章。HTTP 的 PUT /api/chapters/:id 拿的是 id，不是章号 */
    getChapterById: readChapterById,
    /**
     * 改一章。**按 id 改**，只动传进来的那几个字段（不像 saveChapterOutline 那样整条覆盖）——
     * 前端在章纲页改一个标题，不该把 place_raw 和字数目标一起抹掉。
     */
    updateChapter(id: number, patch: ChapterOutlinePatch): ChapterOutline | null {
      if (!readChapterById(id)) return null
      const sets: string[] = []
      const params: Array<string | number | null> = []

      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new TypeError('title 不能为空')
        sets.push('title = ?')
        params.push(patch.title.trim())
      }
      for (const [field, column] of [
        ['goal', 'goal'],
        ['conflict', 'conflict'],
        ['hook', 'hook'],
        ['emotion', 'emotion'],
        ['summary', 'summary'],
      ] as const) {
        const value = patch[field]
        if (value === undefined) continue
        sets.push(`${column} = ?`)
        params.push(value)
      }
      if (patch.place !== undefined) {
        const placeRaw = patch.place.trim()
        sets.push('place_raw = ?', 'place_id = ?')
        params.push(placeRaw, locationIdByName(placeRaw))
      }
      if (patch.wordCountTarget !== undefined) {
        if (!Number.isInteger(patch.wordCountTarget) || patch.wordCountTarget < 1) throw new TypeError('wordCountTarget 必须是正整数')
        sets.push('word_count_target = ?')
        params.push(patch.wordCountTarget)
      }

      if (sets.length === 0) return readChapterById(id)
      database
        .query(`UPDATE chapters SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(...params, id)
      return readChapterById(id)
    },
    listChapters(volumeId?: number): ChapterOutline[] {
      const rows = volumeId === undefined
        ? (database.query('SELECT * FROM chapters ORDER BY idx').all() as Array<Record<string, unknown>>)
        : (database.query('SELECT * FROM chapters WHERE volume_id = ? ORDER BY idx').all(volumeId) as Array<Record<string, unknown>>)
      return rows.map(toChapter)
    },
    /** 最大章号，一章都没有时返回 0。下一卷的起始章号靠它算 */
    maxChapterIdx(): number {
      return Number((database.query('SELECT coalesce(max(idx), 0) AS v FROM chapters').get() as { v: number }).v)
    },

    /* ==================== 出场角色 ==================== */
    /** 重建一章的名单（按章号找章） */
    saveCast(chapterIdx: number, raws: string[]): ChapterCast[] {
      const row = readChapterRow(chapterIdx)
      if (!row) throw new Error(`找不到第 ${chapterIdx} 章，先落库章纲`)
      return database.transaction(() => writeCast(Number(row.id), raws))()
    },
    getCast(chapterIdx: number): ChapterCast[] {
      const row = readChapterRowBy(chapterIdx)
      return row ? getCastByChapterId(Number(row.id)) : []
    },
    /**
     * 角色建好之后，回头把这个名字下所有未解析的出场记录补上。返回补了几条。
     * 场景：章纲先写了"林晚"但卡还没建，后来建好了。
     */
    resolveCast(raw: string, characterId: number): number {
      const normalized = normalizeRaw(raw)
      if (isDemand(normalized)) return 0
      const row = database.query('SELECT id FROM characters WHERE id = ?').get(characterId) as { id: number } | null
      if (!row) throw new TypeError(`character_id=${characterId} 不存在`)
      return database
        .query(`UPDATE chapter_cast SET character_id = ?, resolved_at = datetime('now','localtime') WHERE character_id IS NULL AND raw = ?`)
        .run(characterId, normalized).changes
    },
    /** 待办清单：章纲里写了 `NEW:` 但还没兑现的角色与地点 */
    pendingDemands(): PendingDemand[] {
      const rows = database
        .query(
          `SELECT 'character' AS kind, c.idx AS chapter_idx, cs.raw AS raw
             FROM chapter_cast cs JOIN chapters c ON c.id = cs.chapter_id
            WHERE cs.character_id IS NULL AND upper(cs.raw) LIKE 'NEW:%'
            UNION ALL
           SELECT 'location' AS kind, c.idx AS chapter_idx, c.place_raw AS raw
             FROM chapters c
            WHERE c.place_id IS NULL AND upper(c.place_raw) LIKE 'NEW:%'
            ORDER BY chapter_idx, kind`,
        )
        .all() as Array<{ kind: 'character' | 'location'; chapter_idx: number; raw: string }>
      return rows.map((row) => ({ kind: row.kind, chapterIdx: Number(row.chapter_idx), raw: String(row.raw), need: demandNeed(String(row.raw)) }))
    },

    /* ==================== 正文（逻辑不变） ==================== */
    getText(chapterIdx: number, stage: TextStage): ChapterText | null {
      const chapter = this.getChapter(chapterIdx)
      if (!chapter) return null
      const row = database.query('SELECT id, chapter_id, stage, text, summary, ends_with, polish_report FROM chapter_texts WHERE chapter_id = ? AND stage = ?').get(chapter.id, stage) as Record<string, unknown> | null
      return row ? {
        id: Number(row.id), chapterId: Number(row.chapter_id), stage: row.stage as TextStage, text: String(row.text), summary: String(row.summary), endsWith: String(row.ends_with), polishReport: JSON.parse(String(row.polish_report || '[]')),
      } : null
    },
    saveText(chapterIdx: number, input: { stage: TextStage; text: string; summary?: string; endsWith?: string; polishReport?: unknown }): ChapterText {
      const chapter = this.getChapter(chapterIdx)
      if (!chapter) throw new Error(`找不到第 ${chapterIdx} 章`)
      database.query(`INSERT INTO chapter_texts (chapter_id, stage, text, summary, ends_with, polish_report) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chapter_id, stage) DO UPDATE SET text=excluded.text, summary=excluded.summary, ends_with=excluded.ends_with, polish_report=excluded.polish_report, updated_at=datetime('now','localtime')`).run(chapter.id, input.stage, input.text, input.summary ?? '', input.endsWith ?? '', JSON.stringify(input.polishReport ?? []))
      return this.getText(chapterIdx, input.stage)!
    },

    /* ==================== 任务（逻辑不变） ==================== */
    planTask(stage: ChapterStage, targetKey: string, inputHash = ''): GenerationTask {
      const existing = readTaskByKey(stage, targetKey)
      if (!existing) {
        const result = database.query('INSERT INTO generation_tasks (stage, target_key, input_hash) VALUES (?, ?, ?)').run(stage, targetKey, inputHash)
        return readTask(Number(result.lastInsertRowid))!
      }
      if (inputHash && inputHash !== existing.inputHash) {
        database.query("UPDATE generation_tasks SET input_hash = ?, status = 'pending', error = '', updated_at = datetime('now','localtime') WHERE id = ?").run(inputHash, existing.id)
      }
      return readTask(existing.id)!
    },
    claimTask(stage: ChapterStage, targetKey: string, inputHash = ''): { action: 'run' | 'skip'; taskId: number; task: GenerationTask } {
      const task = this.planTask(stage, targetKey, inputHash)
      if (task.status === 'done' && inputHash && task.inputHash === inputHash) return { action: 'skip', taskId: task.id, task }
      database.query("UPDATE generation_tasks SET status = 'running', attempt = attempt + 1, started_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?").run(task.id)
      const claimed = readTask(task.id)!
      return { action: 'run', taskId: claimed.id, task: claimed }
    },
    finishTask(taskId: number, artifactPath = ''): GenerationTask {
      database.query("UPDATE generation_tasks SET status = 'done', artifact_path = ?, finished_at = datetime('now','localtime'), error = '', updated_at = datetime('now','localtime') WHERE id = ?").run(artifactPath, taskId)
      return readTask(taskId)!
    },
    failTask(taskId: number, error: string): GenerationTask {
      database.query("UPDATE generation_tasks SET status = 'failed', error = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(error.slice(0, 2000), taskId)
      return readTask(taskId)!
    },
    getTask: readTask,
  }
}

/* ==================== 校验 ==================== */

const assertVolume = (input: VolumeInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('卷必须是对象')
  if (!Number.isInteger(input.no) || input.no < 1) throw new TypeError('no 必须是从 1 开始的整数')
  if (!input.name?.trim()) throw new TypeError('name 不能为空')
  if (!Number.isInteger(input.startChapter) || !Number.isInteger(input.endChapter)) throw new TypeError('起止章号必须是整数')
  if (input.endChapter < input.startChapter) throw new TypeError('endChapter 不能小于 startChapter')
}

const assertChapter = (input: ChapterOutlineInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('章纲必须是对象')
  if (!Number.isInteger(input.index) || input.index < 1) throw new TypeError('index 必须是正整数')
  if (!input.title?.trim()) throw new TypeError('title 不能为空')
  if (input.characters !== undefined && !Array.isArray(input.characters)) throw new TypeError('characters 必须是数组')
}

/* ==================== 行 → 领域对象 ==================== */

const toTask = (row: TaskRow): GenerationTask => ({ id: Number(row.id), stage: row.stage, targetKey: String(row.target_key), status: row.status, attempt: Number(row.attempt), inputHash: String(row.input_hash), error: String(row.error) })

const toVolume = (row: Record<string, unknown>): Volume => ({
  id: Number(row.id),
  no: Number(row.no),
  name: String(row.name),
  goal: String(row.goal),
  fromState: String(row.from_state),
  toState: String(row.to_state),
  startChapter: Number(row.start_chapter),
  endChapter: Number(row.end_chapter),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})

const toChapter = (row: Record<string, unknown>): ChapterOutline => ({
  id: Number(row.id),
  volumeId: Number(row.volume_id),
  idx: Number(row.idx),
  title: String(row.title),
  goal: String(row.goal),
  conflict: String(row.conflict),
  hook: String(row.hook),
  emotion: String(row.emotion),
  summary: String(row.summary),
  placeRaw: String(row.place_raw),
  placeId: row.place_id === null || row.place_id === undefined ? null : Number(row.place_id),
  wordCountTarget: Number(row.word_count_target),
})

const toCast = (row: Record<string, unknown>): ChapterCast => ({
  id: Number(row.id),
  chapterId: Number(row.chapter_id),
  raw: String(row.raw),
  characterId: row.character_id === null || row.character_id === undefined ? null : Number(row.character_id),
  resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : String(row.resolved_at),
  createdAt: String(row.created_at),
})
