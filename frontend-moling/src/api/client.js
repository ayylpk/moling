/**
 * 接口客户端 —— **全站 URL 只出现在这一个文件里**，页面一律调方法名。
 *
 * 基座：agent/storage/server.ts（根 package.json 的 `npm run api:dev` 起的就是它，:3000）。
 * 走 vite proxy（/api → :3000），所以这里一律相对路径，禁写死绝对地址（DESIGN.md 第七节）。
 *
 * ⚠️ 项目里还有第二个后端 agent/my-app/src/index.ts（Hono，同样 :3000，两者互斥）。
 * 它的路由更全（worlds / volumes / outline / generation / decisions），但 URL 形态不同：
 *   正文：my-app = PUT /api/novels/:id/chapters/:cid/texts ／ storage = PUT /api/chapters/:cid/text?stage=
 * 将来换基座、或把两者并到一个端口，只改本文件，页面不用动。
 */

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    throw new Error((await response.json().catch(() => null))?.message || `请求失败：${response.status}`);
  }
  return response.status === 204 ? null : response.json();
};

export const api = {
  /* ==================== 小说 ==================== */
  /** 目录库里的全部小说（title/genre/style/description/logline/target_words/themes/status） */
  listNovels: () => request('/api/novels'),
  getNovel: (id) => request(`/api/novels/${id}`),
  createNovel: (novel) => request('/api/novels', { method: 'POST', body: JSON.stringify(novel) }),

  /* ==================== 世界观 ==================== */
  listWorlds: (novelId) => request(`/api/novels/${novelId}/worlds`),
  createWorld: (novelId, world) => request(`/api/novels/${novelId}/worlds`, { method: 'POST', body: JSON.stringify(world) }),

  /* ==================== 角色（固定设定；动态画像见 listPortraits） ==================== */
  listCharacters: (novelId) => request(`/api/novels/${novelId}/characters`),
  createCharacter: (novelId, character) => request(`/api/novels/${novelId}/characters`, { method: 'POST', body: JSON.stringify(character) }),
  updateCharacter: (novelId, characterId, patch) => request(`/api/novels/${novelId}/characters/${characterId}`, { method: 'PUT', body: JSON.stringify(patch) }),

  /* ==================== 地点 ==================== */
  listLocations: (novelId) => request(`/api/novels/${novelId}/locations`),
  createLocation: (novelId, location) => request(`/api/novels/${novelId}/locations`, { method: 'POST', body: JSON.stringify(location) }),

  /* ==================== 大纲（全篇锚点 + 卷纲） ==================== */
  /** { anchor, volumeOutlines, driftedVolumeIds } */
  getOutline: (novelId) => request(`/api/novels/${novelId}/outline`),
  saveOutline: (novelId, payload) => request(`/api/novels/${novelId}/outline`, { method: 'POST', body: JSON.stringify(payload) }),

  /* ==================== 卷 ==================== */
  /** 卷表（no/name/goal/fromState/toState/起止章 + hasOutline） */
  listVolumes: (novelId) => request(`/api/novels/${novelId}/volumes`),
  createVolume: (novelId, volume) => request(`/api/novels/${novelId}/volumes`, { method: 'POST', body: JSON.stringify(volume) }),

  /* ==================== 章与正文 ==================== */
  /** 一本书的全部章节：id/idx/title/volume_id/goal/conflict/hook/emotion/summary/textStage */
  listChapters: (novelId) => request(`/api/novels/${novelId}/chapters`),
  createChapter: (novelId, chapter) => request(`/api/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify(chapter) }),
  updateChapter: (chapterId, patch) => request(`/api/chapters/${chapterId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  /** 取某一阶段的正文；没有则返回 {chapter_id, stage, text:''} */
  getChapterText: (chapterId, stage = 'draft') => request(`/api/chapters/${chapterId}/text?stage=${stage}`),
  saveChapterText: (chapterId, text, stage = 'draft') =>
    request(`/api/chapters/${chapterId}/text?stage=${stage}`, { method: 'PUT', body: JSON.stringify({ text }) }),

  /* ==================== 动态画像与工作流状态 ==================== */
  /**
   * 每个角色最新一版动态画像（profile/tags/依据条数）。
   * **只读**：页面不提供记忆链路的任何维护入口（既没有编辑，也没有"重新提取"这类按钮）。
   */
  listPortraits: (novelId) => request(`/api/novels/${novelId}/portraits`),
  /**
   * 工作流摘要：{ phase, label, total, done, running, failed, byStage }。
   * **只有聚合后的数字** —— generation_tasks 的原始字段（target_key / input_hash…）
   * 是 Agent 的内部实现，前端既不读它的细节，也不替它管任务队列。
   */
  workflow: (novelId) => request(`/api/novels/${novelId}/workflow`),

  /* ==================== 中心 Agent ==================== */
  chat: (novelId, message, history) => request(`/api/novels/${novelId}/chat`, { method: 'POST', body: JSON.stringify({ message, history }) }),
};
