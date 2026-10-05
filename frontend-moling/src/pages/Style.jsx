import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 文风页：三样东西 —— 文风基准、专名白名单、AI 味禁语。
 *
 * 数据来源（都在现有接口上，不需要新接口）：
 *   文风基准 → `GET /api/novels/:id` 的 `style`（novels 表，逐章注入写手提示词）
 *   专名 / 禁语 → `GET /api/novels/:id/worlds` 的当前版本 `terms[]` / `forbidden[]`
 *
 * 红线：禁语只染赭石（提醒职），不上朱砂。没有数据就直说没有 —— 之前这里摆的是别的书的清单。
 */
export default function Style() {
  const { novel } = useWorkbench();
  const [worlds, setWorlds] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!novel?.id) {
      setWorlds([]);
      setLoaded(true);
      return undefined;
    }
    let active = true;
    setLoaded(false);
    setError('');
    api.listWorlds(novel.id)
      .then((items) => { if (active) setWorlds(Array.isArray(items) ? items : []); })
      .catch((cause) => { if (active) { setWorlds([]); setError(cause.message || '读不到世界观'); } })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  if (!novel) {
    return (
      <main className="wb-page enter">
        <BlockTitle mark="风" name="文风" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>
      </main>
    );
  }

  const world = worlds[0] || null;
  const terms = world?.terms || [];
  const forbidden = world?.forbidden || [];

  return (
    <main className="wb-page enter">
      <BlockTitle mark="风" name="文风" />

      {error && <p className="anno">{error}</p>}

      <div className="style__grid">
        {/* 左：全书的「口吻」，逐章注入，必须持久 */}
        <div className="card">
          <div className="field">
            <p className="field__k" data-en="novels.style">文风基准</p>
            {novel.style
              ? <p className="field__v field__v--prose">{novel.style}</p>
              : <p className="anno">这本书还没定文风。建书稿时填的那一条就是它，逐章注入写手提示词。</p>}
            <p className="anno" style={{ marginTop: 10 }}>
              每章都带，改一次全稿重校。
            </p>
          </div>

          <div className="field">
            <p className="field__k" data-en="worlds.forbidden">AI 味禁语</p>
            <div className="chip-row">
              {forbidden.map((word) => (
                <span className="chip chip--forbid" key={word}>{word}</span>
              ))}
              {forbidden.length === 0 && (
                <span className="anno">{world ? '这一版世界观没列禁语。' : '还没有世界观，禁语表跟着世界观一起定。'}</span>
              )}
            </div>
          </div>
        </div>

        {/* 右：专名表，润色时一字不许动 */}
        <div className="card">
          <p className="field__k" data-en="worlds.terms">专名白名单</p>
          {terms.length > 0 ? (
            <table className="terms">
              <thead>
                <tr>
                  <th>专名 term</th>
                  <th>备注 note</th>
                  <th>润色处置</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((term, index) => (
                  <tr key={`${term.name}-${index}`}>
                    <td>{term.name}</td>
                    <td>{term.note || '—'}</td>
                    <td>不许改写、不许近义替换</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="anno">{world ? '这一版世界观没列专名。' : '还没有世界观，专名表跟着世界观一起定。'}</p>
          )}
        </div>
      </div>

      {/* 工序：文风不是装饰，是流水线最后两阶的输入 */}
      <section className="block">
        <BlockTitle mark="序" name="润色工序" />
        <p className="anno" style={{ lineHeight: 2 }}>
          写手出初稿 → 润色按「文风基准 + 禁语 + 专名白名单」三张清单回炉成稿。
        </p>
      </section>
    </main>
  );
}
