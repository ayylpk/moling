import BlockTitle from '../components/BlockTitle.jsx';
import { STAGES, NOVEL_STATUS_META } from '../lib/enums.js';

/**
 * 工作台 = 书架。
 * 数据契约：GET /api/novels（列表）+ GET /api/novels/:id/generation（六阶进度）。
 * 当前库是空的（resources/myapp.sqlite novels=[]），所以下面只立一张示例卡
 * （字段取 10/2 流水线真产物 shape）+ 一个待建空位；接数后示例卡整删换 map。
 */
const SAMPLE = {
  slug: 'linjiang',
  title: '临江',
  genre: '青春 · 时间循环',
  style: '白描短句 · 情绪落在物件上',
  status: 'writing',
  // GenerationProgressVO.byStage 的示例值：设/角/场/纲已成，章/润 1/50
  stages: {
    world: { done: 1, total: 1 },
    character: { done: 2, total: 2 },
    location: { done: 9, total: 9 },
    outline: { done: 1, total: 1 },
    chapter: { done: 1, total: 50 },
    polish: { done: 1, total: 50 },
  },
};

export default function Desk() {
  return (
    <main className="wb-page enter">
      <BlockTitle
        mark="台"
        name="工作台 · 书架"
        anno="GET /api/novels · GET /api/novels/:id/generation"
      />

      {/* 工具行：状态筛选（NovelQueryDTO.status）+ 新建（每页至多一枚朱砂主按钮） */}
      <div className="desk__bar">
        <div className="chip-row">
          <span className="chip" style={{ borderColor: 'rgba(33,30,24,.4)', color: 'var(--m-ink)' }}>
            全部
          </span>
          {Object.entries(NOVEL_STATUS_META).map(([k, v]) => (
            <span className="chip" key={k}>{v.label}</span>
          ))}
        </div>
        <button type="button" className="btn btn--primary">
          ＋ 新建书稿
        </button>
      </div>

      {/* 书卡栅格：一卡一书（任务原子性同 CrewForge 铁律：进度按阶整读整写） */}
      <section className="desk__grid">
        <article className="card">
          <div className="book__head">
            <span className="book__title">
              《{SAMPLE.title}》<em className="demo">示例</em>
            </span>
            <span className={`status ${NOVEL_STATUS_META[SAMPLE.status].cls}`}>
              {NOVEL_STATUS_META[SAMPLE.status].label}
            </span>
          </div>
          <p className="anno book__slug">
            slug <b>linjiang</b> · 盘位 resources/runs/linjiang/
          </p>
          <div className="book__meta">
            <span className="chip">{SAMPLE.genre}</span>
            <span className="chip">{SAMPLE.style}</span>
          </div>

          {/* 流水线六阶：done=done_total 即满，色职见下方注 */}
          <div className="stages">
            {STAGES.map((s) => {
              const st = SAMPLE.stages[s.key];
              const full = st.done === st.total;
              return (
                <span className={`stage${full ? ' is-done' : ''}`} key={s.key} title={`${s.key} · ${st.done}/${st.total}`}>
                  <span className="stage__zh">{s.zh}</span>
                  <span>
                    {st.done}/{st.total}
                  </span>
                </span>
              );
            })}
          </div>
          <p className="anno" style={{ marginTop: 10 }}>
            阶色职：已成浓墨 · 在写花青 · 作废赭石 · 折笔深朱 —— 数据 GenerationProgressVO.byStage
          </p>
        </article>

        {/* 待建位：第二部书（POST /api/novels，slug 即磁盘目录名） */}
        <div className="slot">
          <span>第二部 · 待建</span>
          <span className="anno">POST /api/novels {`{slug, title, genre?, style?}`}</span>
        </div>
      </section>

      {/* 图例：六阶名与后端键一一对应，防两头叫法漂移 */}
      <section className="block">
        <BlockTitle mark="阶" name="流水线六阶" anno="STAGE_ORDER · agent/db/types/entity.ts" />
        <div className="chip-row">
          {STAGES.map((s) => (
            <span className="chip" key={s.key}>
              {s.zh} <span className="anno">{s.key}</span>
            </span>
          ))}
        </div>
        <p className="anno" style={{ marginTop: 12 }}>
          顺序即失效传播方向：上游一变（如世界观起新版），本阶段及下游任务全部作废 ——
          POST /api/novels/:id/generation/invalidate {`{from_stage}`}。
          执笔诸手：Architect 架构 · Character 角色 · Location 场景 · writer 写章 · Polisher 润色 · Actor 决策模拟。
        </p>
      </section>
    </main>
  );
}
