/**
 * 接口总表 —— 登记**当前基座**已有的路由，供查阅与将来取数时对照。
 *
 * 基座：`agent/storage/server.ts`（根 `npm run api:dev` 起的就是它，:3000）。
 * 挂 vite proxy（/api → :3000），所以一律相对路径；DESIGN.md 第七节：禁绝对地址。
 *
 * ⚠️ **真正被页面调用的是 `src/api/client.js`**（全站 URL 只写在那一个文件里），
 * 本文件是给人看的登记表，没有被任何模块 import。
 * 两份东西的分工：client.js = 可执行的方法；这里 = 路由清单与语义备忘。
 * 改接口时两边都要看，但**只有 client.js 需要改代码**。
 *
 * 库的分层（决定"这个数据从哪来"）：
 *   resources/catalog.sqlite               —— 目录级元数据（novels）
 *   resources/novels/<slug>/novel.sqlite   —— 一本小说的全部业务数据
 * 没有第二个后端了：旧的 `agent/my-app/src/index.ts`（Hono，同样监听 :3000）
 * 已不在运行配方里，其独占路由（worlds/search、generation/*、decisions）**不再提供**。
 * 任务队列（generation_tasks）与记忆链路都是内部实现，不对外开接口。
 */
export const API = {
  /* ==================== 小说（目录库） ==================== */
  /** GET /api/novels —— 全部小说（按 updated_at 倒序） */
  novels: () => '/api/novels',
  /** POST /api/novels —— body: {slug,title,genre?,style?,description?,logline?,target_words?,themes?,status?} */
  createNovel: '/api/novels',
  /** GET /api/novels/:id */
  novel: (id) => `/api/novels/${id}`,

  /* ==================== 世界观（多版本） ==================== */
  /** GET /api/novels/:id/worlds —— 全部版本（读当前版本取列表第一项） */
  worlds: (novelId) => `/api/novels/${novelId}/worlds`,
  /** POST /api/novels/:id/worlds —— 改内容起新版，勿原地改 */
  createWorld: (novelId) => `/api/novels/${novelId}/worlds`,

  /* ==================== 角色（固定设定；动态画像另有一路） ==================== */
  characters: (novelId) => `/api/novels/${novelId}/characters`,
  createCharacter: (novelId) => `/api/novels/${novelId}/characters`,
  updateCharacter: (novelId, characterId) => `/api/novels/${novelId}/characters/${characterId}`,
  /** GET /api/novels/:id/portraits —— 每个角色最新一版动态画像（自动归并，只读） */
  portraits: (novelId) => `/api/novels/${novelId}/portraits`,

  /* ==================== 地点 ==================== */
  locations: (novelId) => `/api/novels/${novelId}/locations`,
  createLocation: (novelId) => `/api/novels/${novelId}/locations`,

  /* ==================== 大纲（全篇锚点 + 卷纲） ==================== */
  /** GET /api/novels/:id/outline —— { anchor, volumeOutlines, driftedVolumeIds } */
  outline: (novelId) => `/api/novels/${novelId}/outline`,
  /** POST /api/novels/:id/outline —— body: {anchor?, volumeOutline?}（至少给一个，整体一个事务） */
  saveOutline: (novelId) => `/api/novels/${novelId}/outline`,

  /* ==================== 卷与章 ==================== */
  volumes: (novelId) => `/api/novels/${novelId}/volumes`,
  createVolume: (novelId) => `/api/novels/${novelId}/volumes`,
  chapters: (novelId) => `/api/novels/${novelId}/chapters`,
  createChapter: (novelId) => `/api/novels/${novelId}/chapters`,
  /** PUT /api/chapters/:id —— body: {title?,goal?,conflict?,hook?,emotion?,summary?,place?,word_count_target?} */
  chapter: (chapterId) => `/api/chapters/${chapterId}`,

  /* ==================== 正文 ==================== */
  /** GET/PUT /api/chapters/:id/text?stage=draft|final */
  chapterText: (chapterId, stage = 'draft') => `/api/chapters/${chapterId}/text?stage=${stage}`,

  /* ==================== 中心 Agent 与工作流状态 ==================== */
  /** POST /api/novels/:id/chat —— body: {message, history?}；唯一与作者对话的入口 */
  chat: (novelId) => `/api/novels/${novelId}/chat`,
  /** GET /api/novels/:id/workflow —— {phase,label,total,done,running,failed,byStage}（只有聚合值） */
  workflow: (novelId) => `/api/novels/${novelId}/workflow`,
};
