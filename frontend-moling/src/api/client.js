const request = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || `请求失败：${response.status}`);
  return response.status === 204 ? null : response.json();
};

export const api = {
  listNovels: () => request('/api/novels'),
  getNovel: (id) => request(`/api/novels/${id}`),
  getChapterText: (id, stage = 'draft') => request(`/api/chapters/${id}/text?stage=${stage}`),
  saveChapterText: (id, text, stage = 'draft') => request(`/api/chapters/${id}/text?stage=${stage}`, { method: 'PUT', body: JSON.stringify({ text }) }),
  listPortraits: (novelId) => request(`/api/novels/${novelId}/portraits`),
};
