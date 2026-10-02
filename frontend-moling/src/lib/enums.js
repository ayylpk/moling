/**
 * 后端枚举的前端镜像 —— 唯一权威在 agent/db/types/entity.ts。
 * 后端改值，这里同步；两头对不上时以 entity.ts 为准。
 * （类比 Java：这相当于把对方的 enum 类抄一份常量表，靠注释约定同步。）
 */

/** 流水线六阶，顺序即失效传播方向（STAGE_ORDER）：上游一变，下游全 stale */
export const STAGES = [
  { key: 'world', zh: '设定', mark: '设' },
  { key: 'character', zh: '角色', mark: '色' },
  { key: 'location', zh: '场景', mark: '场' },
  { key: 'outline', zh: '大纲', mark: '纲' },
  { key: 'chapter', zh: '章节', mark: '章' },
  { key: 'polish', zh: '润色', mark: '润' },
];

/** novels.status（NOVEL_STATUS）→ 界面叫法 + 色职（见 DESIGN 红线 3：朱砂不上状态） */
export const NOVEL_STATUS_META = {
  draft: { label: '草稿', cls: 'is-draft' },
  writing: { label: '在写', cls: 'is-writing' },
  paused: { label: '停笔', cls: 'is-paused' },
  done: { label: '已成', cls: 'is-done' },
};

/** generation_tasks.status（TASK_STATUS）→ 色职 */
export const TASK_STATUS_META = {
  pending: { label: '待跑', cls: 'is-pending' },
  running: { label: '在写', cls: 'is-running' },
  done: { label: '已成', cls: 'is-done' },
  failed: { label: '折笔', cls: 'is-failed' },
  stale: { label: '作废', cls: 'is-stale' },
};
