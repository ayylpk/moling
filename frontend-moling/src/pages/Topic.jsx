import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 选题页：一本书的「题眼」四问，来自 outline.json → direction（Architect 产物）。
 * 四个字段是后端定死的形状：logline / theme / coreConflict / endingDirection。
 * 值为 10/2 真产物摘录（截断加 …），接数后原样换掉即可，不动版式。
 */
const DIRECTIONS = [
  {
    zh: '一句话故事',
    en: 'logline',
    text:
      '一个在车祸里失去青梅竹马的临江三中高三男生周砚，带着第一段人生的全部记忆回到百日誓师那天清晨，用仅有的一次重来去追回隔街那个一直等他的女孩……',
  },
  {
    zh: '主题',
    en: 'theme',
    text:
      '一个人只有承认自己一直在被谁等着，才配得上那个等了他十几年的人；而真正的偿还不是活下来，是把每一句该说的话都说在当下。',
  },
  {
    zh: '核心冲突',
    en: 'coreConflict',
    text:
      '周砚要在只有一次、且终点不可推迟的第二段人生里，把第一段人生里所有没说出口的话全部说给林晚听；他每用预知改一件事，林晚在第一段人生里的样子就模糊一分……',
  },
  {
    zh: '结局走向',
    en: 'endingDirection',
    text:
      '周砚活过了那场本该撞死林晚的车祸，自己却没能活到最后；录取通知书下来，两张一模一样的，林晚在急诊门口看着它们，没有崩溃，坦然接受……',
  },
];

export default function Topic() {
  return (
    <main className="wb-page enter">
      <BlockTitle mark="题" name="选题" />

      <div className="dir-grid">
        {DIRECTIONS.map((d) => (
          <article className="card dir-card" key={d.en}>
            <div className="field">
              <p className="field__k" data-en={d.en}>
                {d.zh}
              </p>
              {/* 题眼是文气所在，一律宋体读 */}
              <p className="field__v field__v--prose">{d.text}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="chip-row" style={{ marginTop: 22, gap: 12 }}>
        <button type="button" className="btn btn--primary">重新起盘</button>
        <button type="button" className="btn">采纳 · 往大纲走</button>
      </div>
    </main>
  );
}
