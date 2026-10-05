import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { api } from '../api/client.js';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';

/**
 * 角色页：L3 动态画像。
 *
 * 数据来自 `GET /api/novels/:id/portraits` —— 每个角色只取最新一版画像
 * （profile + tags + 依据的 L1 事实条数）。它是**自动归并**出来的，不改固定设定。
 *
 * ⚠️ 固定角色卡（voice/want/cost/need/secret/immutable）在 `characters` 表里，
 * 而那张表现在**没有任何东西往 per-novel 库写**（角色这一类还没从 my-app 迁过来），
 * 所以这一页当前只有画像可看。之前这里在"没有画像"时回落到另一本书的角色样例 —— 那是假的，已删。
 */
export default function Cast() {
  const { novel } = useWorkbench();
  const [portraits, setPortraits] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!novel?.id) {
      setPortraits([]);
      setLoaded(true);
      return undefined;
    }
    let active = true;
    setLoaded(false);
    api.listPortraits(novel.id)
      .then((items) => { if (active) setPortraits(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setPortraits([]); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  const cards = portraits.map((portrait) => ({
    key: `${portrait.character_id}-v${portrait.version}`,
    name: portrait.character_name || `角色 ${portrait.character_id}`,
    role: `动态画像 v${portrait.version}`,
    voice: portrait.profile,
    tags: JSON.parse(portrait.tags || '[]'),
    source: JSON.parse(portrait.based_on_fact_ids || '[]').length,
  }));

  return (
    <main className="wb-page enter">
      <BlockTitle mark="色" name="角色" />

      <div className="portrait-intro">
        <span className="portrait-intro__mark">L3</span>
        <div>
          <strong>动态画像</strong>
          <p>由小说记忆自动归并，只展示当前状态，不改动角色固定设定。</p>
        </div>
      </div>

      {!novel && <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>}
      {novel && !loaded && <p className="anno">正在取画像……</p>}
      {novel && loaded && cards.length === 0 && (
        <div className="card">
          <p className="anno">
            《{novel.title}》还没有角色画像。画像由小说记忆自动归并 ——
            先把世界观与角色卡落库、正文写出 L0/L1 事实之后，这一页才会有内容。
          </p>
        </div>
      )}

      <div className="cast__grid">
        {cards.map((p) => (
          <article className="card char" key={p.key}>
            <div className="char__head">
              <span className="char__name">{p.name}</span>
              <span className="chip">{p.role}</span>
            </div>

            <div className="char__fields">
              <div className="field">
                <p className="field__k" data-en="profile">当前画像</p>
                <p className="field__v field__v--prose">{p.voice}</p>
              </div>
              {p.tags?.length > 0 && <div className="field"><p className="field__k" data-en="tags">近期状态</p><div className="chip-row">{p.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div></div>}
              {p.source > 0 && <div className="field"><p className="field__k" data-en="evidence">依据</p><p className="field__v">{p.source} 条 L1 事实</p></div>}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
