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
 * HTTP 只有 storage server 一个入口；`agent/my-app/src/index.ts` 是它内部复用的业务门面，
 * 不单独监听端口。任务队列（generation_tasks）与记忆链路都是内部实现，不对外开接口。
 *
 * ── 两条容易踩的约定 ──
 * ① **凡是只有 chapterId 的路由都必须带 novelId**（`?novelId=`）。
 *    chapterId 是每本书各自从 1 开始的自增主键，挨本找会写到别人的书里。
 * ② `/api/flavors` 的清单**读的是 agent/skills/ 下的目录**，不在代码里写死。
 *    加一种文风或类型就是加一个目录，这个接口与前端的下拉自动跟着变。
 */
export const API = {
  /* ==================== 小说（目录库） ==================== */
  /** GET /api/novels —— 全部小说（按 updated_at 倒序） */
  novels: () => '/api/novels',
  /**
   * POST /api/novels —— body: {slug,title,genre?,style?,description?,logline?,target_words?,themes?,status?}
   * 返回体除小说本身还带 `flavorHints`：{ style: string[]|null, genre: string[]|null }。
   * 非 null = 这个名字在 skills 目录下没有片段（可能是拼错，也可能是作者自定的文风）。
   * **它不拦建书** —— 提示而已，拦下来是替作者做主。
   */
  createNovel: '/api/novels',
  /** GET /api/novels/:id */
  novel: (id) => `/api/novels/${id}`,

  /* ==================== 建书可选维度 ==================== */
  /** GET /api/flavors —— { styles: string[], genres: string[] }，取自 agent/skills/ 下的目录名 */
  flavors: () => '/api/flavors',

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
  /** GET /api/novels/:id/chapters —— 章纲 + textStage（final → draft → none 现算） */
  chapters: (novelId) => `/api/novels/${novelId}/chapters`,
  /** POST /api/novels/:id/chapters —— body 可传单条或 { volume_no, chapters: [...] }（逐条兜错） */
  createChapter: (novelId) => `/api/novels/${novelId}/chapters`,
  /** PUT /api/chapters/:id?novelId= —— body: {title?,goal?,conflict?,hook?,emotion?,summary?,place?,word_count_target?} */
  chapter: (chapterId, novelId) => `/api/chapters/${chapterId}?novelId=${novelId}`,

  /* ==================== 正文 ==================== */
  /** GET/PUT /api/chapters/:id/text?stage=draft|final&novelId= */
  chapterText: (chapterId, stage = 'draft', novelId) => `/api/chapters/${chapterId}/text?stage=${stage}&novelId=${novelId}`,

  /* ==================== 中心 Agent 与工作流状态 ==================== */
  /** POST /api/novels/:id/chat —— body: {message, history?}；唯一与作者对话的入口 */
  chat: (novelId) => `/api/novels/${novelId}/chat`,
  /** GET /api/novels/:id/workflow —— {phase,label,total,done,running,failed,byStage}（只有聚合值） */
  workflow: (novelId) => `/api/novels/${novelId}/workflow`,
  /** GET /api/novels/:id/agents —— 执笔画布的灯位视图（七盏灯 + 案心） */
  agents: (novelId) => `/api/novels/${novelId}/agents`,
};
