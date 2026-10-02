import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 大纲页：structure.acts（三幕）+ pacing.tensionCurve（张力曲线）+ constraints（硬约束）。
 * 全部来自 outline.json —— 接数前这里就是大纲页的「目录感」样板：
 * 幕是卡片，张力是细墨条，约束是一张名单。
 */

// structure.acts 真值（10/2 产物，summary 太长此处只上 goal）
const ACTS = [
  {
    id: 'act-1',
    name: '第一段人生：没被看见的那一个',
    range: '第 1–13 章',
    goal: '让读者完整认识第一段人生里那个一直站在原地的林晚，并让周砚在车祸与后事之后回到百日誓师那天清晨。',
    events: 6,
  },
  {
    id: 'act-2',
    name: '第二段人生：把话都说在当下',
    range: '第 14–40 章',
    goal: '用预知逐件偿还第一段人生的亏欠；每改一件事，前一段人生里的林晚就模糊一分。',
    events: 6,
  },
  {
    id: 'act-3',
    name: '收尾：两张一模一样的通知书',
    range: '第 41–50 章',
    goal: '终点不可推迟，把该说的全部说完——偿还不是活下来，是说出口。',
    events: 6,
  },
];

// pacing.tensionCurve 前 14 章真值（intensity 1–10）；共 50 章
const TENSION = [3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 9, 7];

// constraints.locations 真值
const PLACES = [
  '临江市', '临江三中', '榕树街', '隔街巷', '临江市第一人民医院',
  '高三(7)班教室', '教学楼天台', '隔街巷旧楼二楼', '门口公交站台',
];

export default function Outline() {
  const peak = Math.max(...TENSION);
  return (
    <main className="wb-page enter">
      <BlockTitle
        mark="纲"
        name="大纲"
        anno="outline.json → structure / pacing / constraints"
      />

      {/* 三幕 */}
      <section className="acts">
        {ACTS.map((a) => (
          <article className="card act" key={a.id}>
            <div className="char__head">
              <span className="char__name" style={{ fontSize: 17 }}>
                {a.name}
              </span>
            </div>
            <p className="anno act__range">{a.range} · keyEvents {a.events} 条</p>
            <div className="field">
              <p className="field__k">幕的差事</p>
              <p className="field__v">{a.goal}<em className="demo">摘录</em></p>
            </div>
          </article>
        ))}
      </section>

      {/* 张力曲线：高度=intensity，峰顶染赭石（进度职，红不上曲线） */}
      <section className="block">
        <BlockTitle mark="力" name="张力曲线" anno="pacing.tensionCurve · 第 1–14 / 50 章真值" />
        <div className="tension">
          {TENSION.map((v, i) => (
            <b
              key={i}
              className={v === peak ? 'is-peak' : ''}
              style={{ height: `${(v / 10) * 56}px` }}
              title={`第 ${i + 1} 章 · intensity ${v}`}
            />
          ))}
          <span className="anno" style={{ marginLeft: 14, alignSelf: 'flex-end' }}>
            …余 36 章待接
          </span>
        </div>
      </section>

      {/* 硬约束：时间线 + 地点名单（写手不许越的东西） */}
      <section className="block">
        <BlockTitle mark="束" name="硬约束" anno="constraints.timeline / constraints.locations" />
        <div className="card">
          <div className="field">
            <p className="field__k">时间线</p>
            <p className="field__v field__v--prose">
              第一段人生：高三百日誓师当天（三月上旬）起，经四次月考、梅雨季、高考，
              到高考结束后约一周的车祸与后事，约一百一十天。第 13 章末尾回到誓师那天清晨，
              第二段人生从同一时刻重新开始。<em className="demo">摘录</em>
            </p>
          </div>
          <div className="field">
            <p className="field__k">地点白名单</p>
            <div className="chip-row">
              {PLACES.map((p) => (
                <span className="chip" key={p}>{p}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
