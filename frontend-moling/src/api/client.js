/**
 * 接口客户端 —— **全站 URL 只出现在这一个文件里**，页面一律调方法名。
 *
 * 基座：agent/storage/server.ts（根 package.json 的 `npm run api:dev` 起的就是它，:3000）。
 * 走 vite proxy（/api → :3000），所以这里一律相对路径，禁写死绝对地址（DESIGN.md 第七节）。
 *
 * HTTP 只有这一条运行入口。`agent/my-app/src/index.ts` 是 storage server 复用的业务门面，
 * 不是第二个 HTTP 服务；页面不直接调用它。正式接口清单见 ./endpoints.js。
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
  /** 建书。返回体除小说本身，还带 flavorHints：风格名拼错时给出正确候选（null 表示没问题） */
  createNovel: (novel) => request('/api/novels', { method: 'POST', body: JSON.stringify(novel) }),

  /* ==================== 建书可选维度 ==================== */
  /**
   * 可选的文风与类型（{ styles: [...], genres: [...] }）。
   *
   * **清单来自后端磁盘上的目录，不在前端写死** —— 加一种文风是加一个文件，
   * 这里和页面都不用动。哪个 agent 用哪些片段由后端决定，前端只管选名字。
   */
  listFlavors: () => request('/api/flavors'),

  /* ==================== 题材与文风库 ==================== */
  /**
   * 一个维度下的全部条目：`{ dimension, agents[], items[] }`。
   *
   * `agents` 是后端给的"这一维度该有哪几片"（类型 7 片、文风 2 片）——
   * 页面靠它渲染编辑框，**不把 7 和 2 写死在前端**。
   * 维度名与条目名都是中文，必须 encodeURIComponent，否则路径里的中文到不了后端。
   */
  listFlavorDimension: (dimension) => request(`/api/flavors/${encodeURIComponent(dimension)}`),
  /** 单个条目：`{ dimension, name, fragments, missing }` */
  getFlavor: (dimension, name) => request(`/api/flavors/${encodeURIComponent(dimension)}/${encodeURIComponent(name)}`),
  /** 建新条目。重名后端会回 409 并带上现成的名字，**不会覆盖** */
  createFlavor: (dimension, name, fragments) =>
    request(`/api/flavors/${encodeURIComponent(dimension)}`, { method: 'POST', body: JSON.stringify({ name, fragments }) }),
  /** 改已有条目：给 `name` 就改名，给 `fragments` 就改内容，两者可一起给 */
  updateFlavor: (dimension, name, patch) =>
    request(`/api/flavors/${encodeURIComponent(dimension)}/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  /** 删除 —— 后端只是把它挪进隔离区，不真删 */
  removeFlavor: (dimension, name) =>
    request(`/api/flavors/${encodeURIComponent(dimension)}/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /**
   * 素材 → 一个类型 + 一个文风草案。**素材不落任何地方**。
   * 三种素材互斥，传其一：`{ text }` / `{ image: { mediaType, base64 } }` / `{ document: { base64 } }`
   */
  generateFlavor: (material) => request('/api/flavors/generate', { method: 'POST', body: JSON.stringify(material) }),

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
  /**
   * 按 chapterId 的这三个接口**必须带 novelId**。
   *
   * chapterId 是每本书各自从 1 开始的自增主键 —— 书架上只要有两本书，
   * 就一定有两本都有 id=1 的章。不带 novelId 时服务器无法判断是哪一本，
   * 会直接报错而不是替我们猜（猜错就是写到别人的书里）。
   */
  updateChapter: (novelId, chapterId, patch) => request(`/api/chapters/${chapterId}?novelId=${novelId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  /** 取某一阶段的正文；没有则返回 {chapter_id, stage, text:''} */
  getChapterText: (novelId, chapterId, stage = 'draft') => request(`/api/chapters/${chapterId}/text?stage=${stage}&novelId=${novelId}`),
  saveChapterText: (novelId, chapterId, text, stage = 'draft') =>
    request(`/api/chapters/${chapterId}/text?stage=${stage}&novelId=${novelId}`, { method: 'PUT', body: JSON.stringify({ text }) }),
  /**
   * 导出正文为 txt。**单章与批量是同一个接口** —— ids 里给一个就是单章。
   *
   * 这里刻意不走 `request()`：它回来的是文件而不是 JSON，出错时后端才回 JSON。
   * 所以必须自己判 status，不能把浏览器直接指到这个地址上 ——
   * 那样一旦出错，浏览器会把一段错误 JSON 存成 .txt 给用户。
   */
  exportChapters: async (novelId, chapterIds) => {
    const response = await fetch(`/api/novels/${novelId}/export?ids=${chapterIds.join(',')}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || `导出失败：${response.status}`);
    }
    // 中文名只认 filename*=UTF-8'' 那一段；解不出来就退回一个能用的兜底名
    const disposition = response.headers.get('Content-Disposition') || '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    let filename = `第${chapterIds.length}章.txt`;
    if (encoded) {
      try { filename = decodeURIComponent(encoded[1]); } catch { /* 用兜底名 */ }
    }
    return { blob: await response.blob(), filename };
  },

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
