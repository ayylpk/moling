/**
 * 空状态：淡烟图（ink-smoke.png，DESIGN 第六节「待用」位，宽 ≤160px）+ 题签语。
 * 只在「确实没有」时出现；未登录/报错不用它（红是印泥，不当警报使）。
 */
export default function EmptyState({ title = '纸上还没落笔', hint }) {
  return (
    <div className="empty">
      <img src="/images/ink-smoke.png" alt="" aria-hidden="true" />
      <p className="empty__title">{title}</p>
      {hint && <p className="anno">{hint}</p>}
    </div>
  );
}
