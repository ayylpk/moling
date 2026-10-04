import BlockTitle from '../components/BlockTitle.jsx';
import { STAGES, NOVEL_STATUS_META } from '../lib/enums.js';

/**
 * 书架：一卡一书，进度按流水线六阶整读整写。
 * 数据接 GET /api/novels + /api/novels/:id/generation 后，SAMPLE 整删换 map。
 */
const BOOKS = [
  {
    title: '临江',
    genre: '青春 · 时间循环',
    style: '白描短句 · 情绪落在物件上',
    status: 'writing',
    stages: {
      world: { done: 1, total: 1 },
      character: { done: 2, total: 2 },
      location: { done: 9, total: 9 },
      outline: { done: 1, total: 1 },
      chapter: { done: 1, total: 50 },
      polish: { done: 1, total: 50 },
    },
  },
];

export default function Desk() {
  return (
    <main className="wb-page enter">
      <BlockTitle mark="台" name="书架" />

      {/* 状态筛选 + 新建（一页至多一枚朱砂主按钮） */}
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

      <section className="desk__grid">
        {BOOKS.map((book) => (
          <article className="card" key={book.title}>
            <div className="book__head">
              <span className="book__title">《{book.title}》</span>
              <span className={`status ${NOVEL_STATUS_META[book.status].cls}`}>
                {NOVEL_STATUS_META[book.status].label}
              </span>
            </div>
            <div className="book__meta">
              <span className="chip">{book.genre}</span>
              <span className="chip">{book.style}</span>
            </div>

            {/* 六阶：done/total，阶位色职 —— 浓墨已成 / 花青在写 / 赭石作废 / 深朱折笔 */}
            <div className="stages">
              {STAGES.map((s) => {
                const st = book.stages[s.key];
                const full = st.done === st.total;
                return (
                  <span className={`stage${full ? ' is-done' : ''}`} key={s.key} title={`${s.key} · ${st.done}/${st.total}`}>
                    <span className="stage__zh">{s.zh}</span>
                    <span>{st.done}/{st.total}</span>
                  </span>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
