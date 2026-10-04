import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 设定页（世界观）：多版本卡片流。
 * 内容贴 10/2 真产物 world.json；接 GET /api/worlds/current?novelId=。
 * 改内容走 POST 起新版（v+1），禁原地 PATCH —— 原地改会让下游产物变「无主」。
 */

// premise 真值（一字未动，它是下游一切的地基）
const PREMISE =
  '在虚构的南方地级市「临江市」，走读制普通高中「临江三中」的高三男生周砚，在第一段人生里因一场车祸失去了青梅竹马林晚，随后回到高三百日誓师那天重来一次；这一次他选择了一直住在隔街那栋空房子里的林晚，而这次重来本身要他用第二段人生的终点来偿还。';

// rules[0] 真值摘录：Rule 顺序有意义，第 1 条 = 根规则
const ROOT_RULE =
  '周砚的意识可以带着第一段人生的全部记忆，回到高三百日誓师那一天的清晨，从那天起重新过一遍高三最后一百天。他记得第一段人生里发生过的每一件事，因此可以提前避开、提前准备、提前说出正确的话。';
const ROOT_COST = '这次重来只有一次，且它的代价写死在第二段人生的终点。';

const PLACES = [
  '临江市', '临江三中', '榕树街', '隔街巷', '市一院',
  '高三(7)班教室', '教学楼天台', '旧楼二楼', '门口公交站台',
];

export default function World() {
  return (
    <main className="wb-page enter">
      <BlockTitle mark="设" name="设定 · 世界观" />

      {/* 版本签：当前生效挂朱点（激活职），新版是「起」不是「改」 */}
      <div className="vstrip">
        <span className="vchip is-current">v1 · 当前生效</span>
        <button type="button" className="btn btn--primary btn--sm">起新版</button>
      </div>

      <div className="card">
        <div className="field">
          <p className="field__k" data-en="premise">总设定</p>
          <p className="field__v field__v--prose">{PREMISE}</p>
        </div>
      </div>

      <section className="block">
        <BlockTitle mark="律" name="世界规则" />
        <div className="card" style={{ padding: '8px 22px 14px' }}>
          <ol className="rules">
            <li className="rule-item">
              <span className="rule-no">一</span>
              <div>
                <p className="field__k">根规则 · 重来</p>
                <p className="field__v field__v--prose">{ROOT_RULE}</p>
                <p className="anno" style={{ marginTop: 6 }}>{ROOT_COST}</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="block">
        <BlockTitle mark="名" name="场景" />
        <div className="card">
          <div className="chip-row">
            {PLACES.map((p) => (
              <span className="chip" key={p}>{p}</span>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
