/**
 * 壳期静态样例的退役记录（10-05 接线）：
 *   NOVELS  → 改由 `GET /api/novels` 提供（WorkbenchLayout 挂载时拉）
 *   VOLUMES → 改由 `GET /api/novels/:id/chapters` 现推（Manuscript 按 volume_id 分组）
 * AGENTS / HUB 静态灯位表已于 10-05 移除：改由 `GET /api/novels/:id/agents` 现算（五盏读 generation_tasks，执笔/润色读 chapter_texts）。
 * 下面三行是「新建书稿」表单的偏好选项，仍是静态。
 */
export const TOPIC_OPTIONS = ['玄幻', '都市', '恋爱', '悬疑', '历史'];
export const STYLE_OPTIONS = ['细腻', '冷峻', '明快', '克制', '浓烈'];
export const WORD_OPTIONS = ['5 万字', '10 万字', '20 万字', '50 万字'];

export const initialPreferences = {
  topics: ['都市', '恋爱'],
  style: '细腻',
  wordCount: '10 万字',
};
