import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 剧情页：逐章事件账（outline.json → chapters[]，每章一条 stage=chapter 任务）。
 * 账表五栏 = chapters 的五个字段：goal/conflict/hook/emotion/(summary)。
 * summary 太长不进表，在书稿页的浮签里读。
 * 暂上两章真账（chapters[0..1]），余章接数后原样换 ROWS 即可。
 */
const ROWS = [
  {
    no: '01',
    title: '倒计时一百天',
    goal: '周砚让陈默把折成方块的纸条在散会时递到苏晴手上。',
    conflict: '纸条传到第三排被郑立平截住，当着全班念出，贴在倒计时旁边。',
    hook: '那张纸条还贴在那儿，倒计时数字从纸背面透出来。',
    emotion: '兴奋 → 僵',
  },
  {
    no: '02',
    title: '坡道下面那棵树',
    goal: '算好苏晴推电动车的时间，在坡道最上面那排车旁等她。',
    conflict: '苏晴一句「行吧，你有事？」挡回来，隔车把站了半分钟，她走了。',
    hook: '林晚还站在榕树底下，手里两瓶水，一瓶已经温了。',
    emotion: '紧张 → 空',
  },
];

export default function Plot() {
  return (
    <main className="wb-page enter">
      <BlockTitle mark="情" name="剧情 · 事件账" />

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
            {ROWS.map((r) => (
              <tr key={r.no}>
                <td>{r.no} {r.title}</td>
                <td>{r.goal}</td>
                <td>{r.conflict}</td>
                <td className="cell-hook">{r.hook}</td>
                <td>{r.emotion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
