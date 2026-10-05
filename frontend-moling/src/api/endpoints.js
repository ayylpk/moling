/**
 * 接口总表 —— 只登记后端「已有」的路由，下一期取数时改这里，页面不写路径。
 * 挂 vite proxy（/api → :3000）后全部相对路径；DESIGN.md 第七节：禁绝对地址。
 *
 * ⚠️ 本项目 :3000 上有两个互斥后端，本文件登记的是**较全的那个**：
 *   agent/my-app/src/index.ts（Hono）—— worlds / generation / characters /
 *     locations / volumes / outline / chapters / decisions
 * 而前端页面实际调用的是 `src/api/client.js`，它对着另一个后端：
 *   agent/storage/server.ts（根 `npm run api:dev` 起的就是它）—— novels /
 *     chapters / 正文 / memories / portraits
 * 两者 URL 形态不同（例：正文 my-app = /api/novels/:id/chapters/:cid/texts，
 * storage = /api/chapters/:cid/text?stage=）。要换基座，先改 client.js。
 *
 * 后端入口：agent/my-app/src/index.ts（Hono，类比 Java 的 Servlet 注册层）
 * 类型契约：agent/db/types/{entity,dto,vo}.ts（DTO 进、VO 出，页面只该消费 VO 形状）
 */
export const API = {
  /* ==================== 小说（全库的根） ==================== */
  /** GET /api/novels?status= —— 省略 status 即全部 */
  novels: () => '/api/novels',
  /** POST /api/novels —— body: CreateNovelDTO {slug,title,genre?,style?,status?} */
  createNovel: '/api/novels',
  /** GET/PATCH/DELETE /api/novels/:id —— DELETE 级联删下游，慎 */
  novel: (id) => `/api/novels/${id}`,
  /** GET /api/novels/slug/:slug —— 磁盘目录名就是 slug */
  novelBySlug: (slug) => `/api/novels/slug/${slug}`,

  /* ==================== 世界观（多版本） ==================== */
  /** GET /api/worlds?novelId= / brief / current / search?kw= */
  worlds: (novelId) => `/api/worlds?novelId=${novelId}`,
  worldsBrief: (novelId) => `/api/worlds/brief?novelId=${novelId}`,
  /** 下游要世界观一律走 current（服务端决定取哪版） */
  worldCurrent: (novelId) => `/api/worlds/current?novelId=${novelId}`,
  /** POST /api/worlds —— 改内容起新版，勿原地 PATCH */
  createWorld: '/api/worlds',

  /* ==================== 生成（断点续跑） ==================== */
  /** GET 进度快照 GenerationProgressVO {total,done,byStage,remaining} */
  progress: (novelId) => `/api/novels/${novelId}/generation`,
  /** GET /tasks?stage=&status= */
  tasks: (novelId) => `/api/novels/${novelId}/generation/tasks`,
  /** POST /plan —— body: {stage, target_keys[], input_hash?} */
  plan: (novelId) => `/api/novels/${novelId}/generation/plan`,
  /** POST /claim —— 返回 {action:'run'|'skip', reason, task}，跳不跳看 input_hash */
  claim: (novelId) => `/api/novels/${novelId}/generation/claim`,
  /** POST /reset-stale —— 清上次中断留下的 running */
  resetStale: (novelId) => `/api/novels/${novelId}/generation/reset-stale`,
  /** POST /invalidate —— body: {from_stage}，本阶段及往下全作废 */
  invalidate: (novelId) => `/api/novels/${novelId}/generation/invalidate`,
  /** POST /tasks/:taskId/finish|fail —— finish 可空 body（不动 artifact_path） */
  finishTask: (novelId, taskId) => `/api/novels/${novelId}/generation/tasks/${taskId}/finish`,
  failTask: (novelId, taskId) => `/api/novels/${novelId}/generation/tasks/${taskId}/fail`,
};
