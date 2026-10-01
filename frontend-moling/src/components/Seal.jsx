/**
 * 方印：默认白文印（红底白字）2×2 排「墨灵之印」；
 * 传单字（如 chars={['灵']}）则作闲章，一字居中。
 * 装饰性元素，对读屏隐藏（旁有文字表意时）。
 */
export default function Seal({
  small = false,
  chars = ['墨', '灵', '之', '印'],
}) {
  const single = chars.length === 1;
  return (
    <span
      className={`seal${small ? ' seal--small' : ''}${single ? ' seal--one' : ''}`}
      aria-hidden="true"
    >
      {chars.map((c) => (
        <i key={c} style={{ fontStyle: 'normal' }}>
          {c}
        </i>
      ))}
    </span>
  );
}
