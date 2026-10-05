import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { api } from '../api/client.js';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';

/**
 * 角色页：固定设定 + 最新一版动态画像。
 *
 * 数据来自两条接口：
 *   GET /api/novels/:id/characters —— 固定设定（voice/want/cost/need/secret/flaw/line/immutable）
 *   GET /api/novels/:id/portraits  —— 每个角色的最新一版动态画像（自动归并，不改固定设定）
 * **一张卡就是一个人**：卡上是设定，设定下面是这人的当前画像。没有画像就如实说没有 ——
 * 之前这里在没有画像时回落到另一本书的角色样例，那是假的，已删。
 *
 * 页面上**不给记忆链路的任何维护入口**（没有编辑、没有"重新提取"之类按钮）：
 * 画像由落库后的记忆自动归并，作者不需要在中间审核任何一步。
 */
const ROLE_ZH = { protagonist: '主角', antagonist: '反派', support: '配角' };
const STATUS_ZH = { alive: '在', dead: '已亡', disabled: '失能' };

export default function Cast() {
  const { novel } = useWorkbench();
  const [characters, setCharacters] = useState([]);
  const [portraits, setPortraits] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!novel?.id) {
      setCharacters([]);
      setPortraits({});
      setLoaded(true);
      setError('');
      return undefined;
    }
    let active = true;
    setLoaded(false);
    setError('');
    Promise.all([api.listCharacters(novel.id), api.listPortraits(novel.id)])
      .then(([people, shots]) => {
        if (!active) return;
        setCharacters(Array.isArray(people) ? people : []);
        const map = {};
        // 接口已按 character_id 只回最新一版；这里再兜一次以防未来返回多版
        for (const shot of Array.isArray(shots) ? shots : []) {
          const previous = map[shot.character_id];
          if (!previous || (shot.version ?? 0) > (previous.version ?? 0)) map[shot.character_id] = shot;
        }
        setPortraits(map);
      })
      .catch((cause) => {
        if (!active) return;
        setCharacters([]);
        setPortraits({});
        setError(cause.message || '读不到角色');
      })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  const parseList = (value) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  if (!novel) {
    return (
      <main className="wb-page enter">
        <BlockTitle mark="色" name="角色" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>
      </main>
    );
  }

  return (
    <main className="wb-page enter">
      <BlockTitle mark="色" name="角色" />

      <div className="portrait-intro">
        <span className="portrait-intro__mark">像</span>
        <div>
          <strong>固定设定 + 动态画像</strong>
          <p>设定是这条流水线的输入，不随剧情改；下面的画像由落库后的记忆自动归并，只展示当前状态。</p>
        </div>
      </div>

      {error && <p className="anno">{error}</p>}
      {!loaded && !error && <p className="anno">正在取角色……</p>}

      {loaded && characters.length === 0 && (
        <div className="card">
          <p className="anno">
            《{novel.title}》还没有角色卡。角色卡由角色 agent 一次造一个、采纳后落库；
            落库之后这一页会列出每个人的设定与当前画像。
          </p>
        </div>
      )}

      <div className="cast__grid">
        {characters.map((person) => {
          const shot = portraits[person.id];
          const tags = shot ? parseList(shot.tags) : [];
          const evidence = shot ? parseList(shot.based_on_fact_ids).length : 0;
          return (
            <article className="card char" key={person.id}>
              <div className="char__head">
                <span className="char__name">{person.name}</span>
                <span className="chip">{ROLE_ZH[person.role] || person.role}</span>
                <span className="chip">{STATUS_ZH[person.status] || person.status}</span>
              </div>

              <div className="char__fields">
                {person.voice && <div className="field"><p className="field__k" data-en="voice">说话方式</p><p className="field__v">{person.voice}</p></div>}
                {(person.want || person.need) && (
                  <div className="field">
                    <p className="field__k" data-en="want">要什么 · 缺什么</p>
                    <p className="field__v">{person.want || '—'} · {person.need || '—'}</p>
                  </div>
                )}
                {person.flaw && <div className="field"><p className="field__k" data-en="flaw">缺陷</p><p className="field__v">{person.flaw}</p></div>}
                {person.line && <div className="field"><p className="field__k" data-en="line">底线</p><p className="field__v">{person.line}</p></div>}
                {parseList(person.immutable).length > 0 && (
                  <div className="field">
                    <p className="field__k" data-en="immutable">不可改</p>
                    <div className="chip-row">{parseList(person.immutable).map((item) => <span className="chip" key={item}>{item}</span>)}</div>
                  </div>
                )}
              </div>

              <div className="field">
                <p className="field__k" data-en="profile">当前画像</p>
                {shot ? (
                  <>
                    <p className="field__v field__v--prose">{shot.profile}</p>
                    {tags.length > 0 && <div className="chip-row">{tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>}
                    {evidence > 0 && <p className="field__v anno">依据 {evidence} 条记忆</p>}
                  </>
                ) : (
                  <p className="field__v anno">这个人还没有画像 —— 正文写出事实之后会自动归并出来。</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
