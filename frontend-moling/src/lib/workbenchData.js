export const NOVELS = [
  {
    id: 1,
    title: '临江',
    slug: 'linjiang',
    genre: '青春 · 时间循环',
    style: '白描短句 · 情绪落在物件上',
    wordCount: '10 万字',
  },
  {
    id: 2,
    title: '雾中灯',
    slug: 'wuzhongdeng',
    genre: '悬疑 · 城市传说',
    style: '冷静克制 · 留白见光',
    wordCount: '20 万字',
  },
];

export const TOPIC_OPTIONS = ['玄幻', '都市', '恋爱', '悬疑', '历史'];
export const STYLE_OPTIONS = ['细腻', '冷峻', '明快', '克制', '浓烈'];
export const WORD_OPTIONS = ['5 万字', '10 万字', '20 万字', '50 万字'];

export const AGENTS = [
  { id: 'world', name: '世界观', mark: '界', stage: 'world', state: 'done', summary: '规则、势力与专名表已立', detail: '当前版本 v1 · 13 条规则 · 6 个地点' },
  { id: 'character', name: '角色', mark: '色', stage: 'character', state: 'running', summary: '正在整理周砚与林晚的关系弧', detail: '已完成 2 / 4 张角色卡' },
  { id: 'location', name: '场景', mark: '景', stage: 'location', state: 'idle', summary: '等待角色关系确认后继续', detail: '待处理需求 3 条' },
  { id: 'outline', name: '大纲', mark: '纲', stage: 'outline', state: 'done', summary: '第一卷三幕结构已锁定', detail: '第 1 卷 · 6 章草纲' },
  { id: 'chapter', name: '章节', mark: '章', stage: 'idle', summary: '等待大纲变更通知', detail: '已完成 1 / 50 章' },
  { id: 'writer', name: '写作', mark: '写', stage: 'chapter', state: 'running', summary: '正在生成第 2 章初稿', detail: '目标 3,000 字 · 已写 1,842 字' },
  { id: 'polish', name: '润色', mark: '润', stage: 'polish', state: 'idle', summary: '等待初稿进入润色队列', detail: '上次完成第 1 章' },
];

export const VOLUMES = [
  {
    id: 1,
    no: 1,
    name: '回到百日誓师',
    goal: '周砚重新选择林晚，并找回被第一段人生错过的答案。',
    chapters: [
      { id: 1, idx: 1, title: '倒计时一百天', status: 'final', hook: '纸条贴在倒计时数字旁边。', emotion: '从兴奋落到僵住。', text: '六月还没到，教室已经热了。\n\n周砚进教室的时候，早读的太阳正从东边那排窗户斜进来，整排桌面晒得发白。\n\n他把书包放下，抬头看向后墙。那里写着三个醒目的数字：一百天。' },
      { id: 2, idx: 2, title: '坡道下面那棵树', status: 'draft', hook: '林晚说她记得另一条路。', emotion: '试探里带着迟疑。', text: '放学后的坡道比记忆里更窄。周砚沿着围墙往下走，远远看见那棵歪向河岸的树。' },
      { id: 3, idx: 3, title: '第一次月考', status: 'outlined', hook: '成绩单背面多了一行字。', emotion: '不安开始有了形状。', text: '' },
      { id: 4, idx: 4, title: '梅雨里的伞', status: 'outlined', hook: '伞下的位置只够两个人。', emotion: '沉默变得太近。', text: '' },
    ],
  },
  { id: 2, no: 2, name: '雨季之后', goal: '关系开始脱离旧轨道。', chapters: [] },
];

export const initialPreferences = {
  topics: ['都市', '恋爱'],
  style: '细腻',
  wordCount: '10 万字',
};
