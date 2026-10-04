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

/**
 * 执笔画布的七盏灯（夜案 v0.5）。
 * state 四档即明暗：running 亮 / done 常 / idle 暗 / failed 沉。
 * reading/tokens/last 是悬停浮签的三行 —— 后端 /api/agents 接入后整表换掉，版式不动。
 * （修 v0.4 遗留：chapter 一项当时漏写了 state，节点渲染成 is-undefined。）
 */
export const AGENTS = [
  { id: 'world', name: '世界观', mark: '界', stage: 'world', state: 'done',
    reading: 'chapter-2 草稿里的地名引用', tokens: '41.2k', cap: '60k', pct: 69,
    last: '昨日定稿 v1 · 13 条规则 · 9 个场景' },
  { id: 'character', name: '角色', mark: '色', stage: 'character', state: 'running',
    reading: '周砚 · 林晚 前 6 章对手戏', tokens: '18.7k', cap: '60k', pct: 31,
    last: '刚补完林晚「秘密」槽位' },
  { id: 'location', name: '场景', mark: '景', stage: 'location', state: 'idle',
    reading: '等角色关系确认后开工', tokens: '0', cap: '60k', pct: 0,
    last: '排队中 · 还有 9 张场景卡' },
  { id: 'outline', name: '大纲', mark: '纲', stage: 'outline', state: 'done',
    reading: '第 2 章章纲回校', tokens: '52.6k', cap: '60k', pct: 88,
    last: '三幕 50 章已锁定' },
  { id: 'chapter', name: '章节任务', mark: '章', stage: 'chapter', state: 'idle',
    reading: '任务队列 ch:003 → ch:050', tokens: '—', cap: '—', pct: 0,
    last: '1 / 50 已成 · 等执笔接手' },
  { id: 'writer', name: '执笔', mark: '写', stage: 'chapter', state: 'running',
    reading: '第 2 章章纲 + 角色卡 · 林晚', tokens: '12.4k', cap: '60k', pct: 21,
    last: '正在写第 2 章初稿 · 1,842 / 3,000 字' },
  { id: 'polish', name: '润色', mark: '润', stage: 'polish', state: 'idle',
    reading: '禁语表 + 专名白名单', tokens: '0', cap: '60k', pct: 0,
    last: '等初稿入队 · 上次完成第 1 章' },
];

/** 案心一盏：中心 Agent（SAgent），浮签语单独标「正在协调」 */
export const HUB = { id: 'hub', name: '中心 Agent', mark: '灵', state: 'running', stateLabel: '正在协调',
  reading: '全书状态 · 第 2 章情绪曲线等人拍板', tokens: '148k', cap: '256k', pct: 58,
  last: '在编子任务 3 · 昨日协调 17 次' };

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
