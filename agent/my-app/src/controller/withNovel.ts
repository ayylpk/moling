import type { Database } from 'bun:sqlite'

import { openNovelDatabase, slugOfNovel } from '../db/connection'

/**
 * controller 层每个动作的固定开头：novelId → 开这本书的库 → 执行 → 关库。
 *
 * ── 为什么这一跳只写在 controller ──
 * 上层有两种消费者：中心 Agent 的 tool 和 HTTP 路由。两者都只认 novelId
 * （tool 从 config.configurable.novelId 拿，路由从路径参数拿），也都不该知道
 * slug 怎么解析、库文件在哪。把这跳收在这里，"打开的是哪本书的库"就只有一种答案。
 *
 * db 层不做这件事：它只接受一个已经开好的 Database，不认识 novelId。
 */
export const withNovel = <T>(novelId: number, action: (database: Database) => T): T => {
  const database = openNovelDatabase(slugOfNovel(novelId))
  try {
    return action(database)
  } finally {
    database.close()
  }
}
