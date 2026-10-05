/**
 * 壳期静态样例的退役记录（10-05 接线）：
 *   NOVELS  → 改由 `GET /api/novels` 提供（WorkbenchLayout 挂载时拉）
 *   VOLUMES → 改由 `GET /api/novels/:id/volumes` 提供（Manuscript 用真卷名；卷表缺失时按 volume_id 现推）
 *   AGENTS / HUB 静态灯位表 → 改由 `GET /api/novels/:id/workflow` 的聚合结果现算（执笔画布）。
 * 也就是说：**这个文件里不再有任何用于展示 Agent 状态的样例数据**，剩下的只有下面三行
 * 「新建书稿」表单的偏好选项 —— 那是表单选项，不是待显示的业务数据。
 */
export const TOPIC_OPTIONS = ['玄幻', '都市', '恋爱', '悬疑', '历史'];
export const STYLE_OPTIONS = ['细腻', '冷峻', '明快', '克制', '浓烈'];
export const WORD_OPTIONS = ['5 万字', '10 万字', '20 万字', '50 万字'];

export const initialPreferences = {
  topics: ['都市', '恋爱'],
  style: '细腻',
  wordCount: '10 万字',
};
