import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 剧情页：逐章事件账。
 *
 * 数据来自 `GET /api/novels/:id/chapters` —— 章纲五字段（goal / conflict / hook / emotion）
 * 就在章表上，是「随大纲一起落库」的那一份。
 * 这一页**只读不改**：章纲由大纲一次性写进来（前端逐章改会让章号连续性没保障）。
 *
 * 章表是空的就直说空 —— 之前这里摆的是别的书的样例账。
 */
export default function Plot() {
  const { novel } = useWorkbench();
  const [chapters, setChapters] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!novel?.id) {
      setChapters([]);
      setLoaded(true);
      return undefined;
    }
    let active = true;
    setLoaded(false);
    setError('');
    api.listChapters(novel.id)
      .then((items) => { if (active) setChapters(Array.isArray(items) ? items : []); })
      .catch((cause) => { if (active) { setChapters([]); setError(cause.message || '读不到章纲'); } })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  if (!novel) {
    return (
      <main className="wb-page enter">
        <BlockTitle mark="情" name="剧情 · 事件账" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>
      </main>
    );
  }

  return (
    <main className="wb-page enter">
      <BlockTitle mark="情" name="剧情 · 事件账" />

      {error && <p className="anno">{error}</p>}
      {!loaded && !error && <p className="anno">正在取章纲……</p>}

      {loaded && chapters.length === 0 && (
        <div className="card">
          <p className="anno">《{novel.title}》还没有章纲。章纲是由大纲一次性落库的，落库后这一页会逐章列出来。</p>
        </div>
      )}

      {chapters.length > 0 && (
        <div className="card" style={{ padding: '6px 22px 14px' }}>
          <table className="ledger">
            <thead>
              <tr>
                <th>章</th>
                <th>目标 goal</th>
                <th>冲突 conflict</th>
                <th>结尾钩子 hook</th>
                <th>情绪</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((row) => (
                <tr key={row.id}>
                  <td>{String(row.idx).padStart(2, '0')} {row.title}</td>
                  <td>{row.goal || '—'}</td>
                  <td>{row.conflict || '—'}</td>
                  <td className="cell-hook">{row.hook || '—'}</td>
                  <td>{row.emotion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
