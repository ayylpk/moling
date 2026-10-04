import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 文风页：三样东西 —— 文风基准（novels.style，逐章注入）、
 * 专名白名单（world.terms，润色的「不许改」清单）、禁语（world.forbidden）。
 * 红线的可视化页：禁语只染赭石（提醒职），不上朱砂。
 */

// 全书文风基准（novels.style），逐章注入写手提示词
const STYLE_BASE = '白描，短句为主；情绪落在动作和物件上，不直接说出来。不用「仿佛」「不禁」，不替读者总结感受。';

// world.json → terms 真值（name + aliases）
const TERMS = [
  { name: '临江市', alias: '—' },
  { name: '临江三中', alias: '三中' },
  { name: '榕树街', alias: '—' },
  { name: '隔街巷', alias: '—' },
  { name: '临江市第一人民医院', alias: '市一院' },
  { name: '周砚', alias: '—' },
  { name: '林晚', alias: '—' },
  { name: '百日誓师', alias: '—' },
  { name: '走读证', alias: '—' },
  { name: '年级公告栏', alias: '—' },
];

// worlds.forbidden[]（润色 agent 的删除清单）
const FORBIDDEN = ['不禁', '仿佛', '缓缓地', '淡淡地', '似乎在思考着什么', '岁月静好'];

export default function Style() {
  return (
    <main className="wb-page enter">
      <BlockTitle mark="风" name="文风" />

      <div className="style__grid">
        {/* 左：全书的「口吻」，逐章注入，必须持久 */}
        <div className="card">
          <div className="field">
            <p className="field__k" data-en="novels.style">文风基准</p>
            <p className="field__v field__v--prose">{STYLE_BASE}</p>
            <p className="anno" style={{ marginTop: 10 }}>
              每章都带，改一次全稿重校。
            </p>
          </div>

          <div className="field">
            <p className="field__k" data-en="worlds.forbidden">AI 味禁语</p>
            <div className="chip-row">
              {FORBIDDEN.map((w) => (
                <span className="chip chip--forbid" key={w}>{w}</span>
              ))}
            </div>
          </div>
        </div>

        {/* 右：专名表，润色时一字不许动 */}
        <div className="card">
          <p className="field__k" data-en="worlds.terms">专名白名单</p>
          <table className="terms">
            <thead>
              <tr>
                <th>专名 term</th>
                <th>通称 alias</th>
                <th>润色处置</th>
              </tr>
            </thead>
            <tbody>
              {TERMS.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td>{t.alias}</td>
                  <td>不许改写、不许近义替换</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 工序：文风不是装饰，是流水线最后两阶的输入 */}
      <section className="block">
        <BlockTitle mark="序" name="润色工序" />
        <p className="anno" style={{ lineHeight: 2 }}>
          写手出初稿 → 润色按「文风基准 + 禁语 + 专名白名单」三张清单回炉成稿。
          第 1 章：初稿 2976 字 → 润后 2972 字。
        </p>
      </section>
    </main>
  );
}
