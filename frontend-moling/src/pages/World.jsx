import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 设定页（世界观）：多版本卡片流。
 * 数据契约：GET /api/worlds/current?novelId=（服务端定「哪版生效」）；
 * 改内容走 POST 起新版（v+1），禁原地 PATCH —— 原地改会让下游产物变「无主」。
 * 内容贴 10/2 真产物 world.json。
 */

// premise 真值（一字未动，它是下游一切的地基）
const PREMISE =
  '在虚构的南方地级市「临江市」，走读制普通高中「临江三中」的高三男生周砚，在第一段人生里因一场车祸失去了青梅竹马林晚，随后回到高三百日誓师那天重来一次；这一次他选择了一直住在隔街那栋空房子里的林晚，而这次重来本身要他用第二段人生的终点来偿还。';

// rules[0] 真值摘录：Rule 顺序有意义，第 1 条 = 根规则
const ROOT_RULE =
  '周砚的意识可以带着第一段人生的全部记忆，回到高三百日誓师那一天的清晨，从那天起重新过一遍高三最后一百天。他记得第一段人生里发生过的每一件事，因此可以提前避开、提前准备、提前说出正确的话。';
const ROOT_COST =
  '这次重来只有一次，且它的代价写死在第二段人生的终点。（rules[0].cost 后半段 · 摘录）';

export default function World() {
  return (
    <main className="wb-page enter">
      <BlockTitle
        mark="设"
        name="设定 · 世界观"
        anno="GET /api/worlds/current?novelId= · worlds 多版本"
      />

      {/* 版本签：当前生效挂朱点（激活职），新版是「起」不是「改」 */}
      <div className="vstrip">
        <span className="vchip is-current">v1 · 当前生效</span>
        <span className="vchip">v2 · 未起</span>
        <button type="button" className="btn btn--primary btn--sm">起新版</button>
        <span className="anno">
          POST /api/worlds 不传 version 自动 +1 · 内容改动一律走新版，旧版留给审计
        </span>
      </div>

      <div className="card">
        <div className="field">
          <p className="field__k" data-en="premise">总设定</p>
          <p className="field__v field__v--prose">{PREMISE}</p>
        </div>
      </div>

      {/* 根规则 + 派生规则位 */}
      <section className="block">
        <BlockTitle mark="律" name="世界规则" anno="worlds.rules[] · Rule{id,text}，顺序即派生" />
        <div className="card" style={{ padding: '8px 22px 14px' }}>
          <ol className="rules">
            <li className="rule-item">
              <span className="rule-no">一</span>
              <div>
                <p className="field__k">根规则 · 重来（摘录）</p>
                <p className="field__v field__v--prose">{ROOT_RULE}</p>
                <p className="anno" style={{ marginTop: 6 }}>{ROOT_COST}</p>
              </div>
            </li>
            <li className="rule-item">
              <span className="rule-no">二</span>
              <div>
                <div className="skel" style={{ width: '68%' }} />
                <div className="skel" style={{ width: '46%' }} />
                <p className="anno">从根规则派生的约束 · rules[1..] 接数后填入</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* 名单区：阵营 / 场景两栏位（Places 由 Location 逐景出卡） */}
      <section className="block">
        <BlockTitle mark="名" name="阵营 · 场景" anno="worlds.factions[] / worlds.places[] + stage=location" />
        <div className="style__grid">
          <div className="slot">
            <span>阵营 factions · 待载入</span>
            <span className="anno">{'Faction{id,name,desc?} · 本书人物关系为主，或可为空'}</span>
          </div>
          <div className="card">
            <p className="field__k" data-en="places">场景 places</p>
            <div className="chip-row">
              {['临江市', '临江三中', '榕树街', '隔街巷', '市一院', '高三(7)班教室', '教学楼天台', '旧楼二楼', '门口公交站台'].map((p) => (
                <span className="chip" key={p}>{p}</span>
              ))}
            </div>
            <p className="anno" style={{ marginTop: 10 }}>
              每景另有 LocationAgent 出的场景卡（stage=location），点 chip 进详情的交互下期接
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
