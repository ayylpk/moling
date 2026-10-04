import { useNavigate } from 'react-router-dom';

/**
 * 对话栏：中心 Agent「灵」的单通道，只在「执笔」模式出现（右侧纸色柱）。
 * 收起后剩 48px 竖轨，按钮变竖排「展开对话」。
 * 消息/请示为壳期静态内容，接 WS/轮询后只换数据源不动版式。
 */
export default function Conversation({ collapsed, onToggle }) {
  const navigate = useNavigate();

  return (
    <aside className={`ws__chat${collapsed ? ' is-collapsed' : ''}`}>
      <div className="conversation__head">
        {!collapsed && (
          <div>
            <span className="conversation__eyebrow">协作频道</span>
            <h2>
              <span className="chat-rail__seal">灵</span>中心 Agent
            </h2>
          </div>
        )}
        <button type="button" className="conversation__collapse" onClick={onToggle}>
          {collapsed ? '展开对话' : '收起对话'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="conversation__context">
            <span className="status is-writing">正在协调</span>
            <strong>第 2 章 · 情绪曲线</strong>
            <span className="anno">在编子任务 3 · 上下文 148k / 256k</span>
          </div>

          <div className="conversation__messages">
            <div className="conversation__message is-agent">
              <span className="conversation__message-label">中心 Agent · 刚刚</span>
              <p>角色弧线已经接上了。第 2 章的情绪曲线需要你确认，我会根据选择继续安排写作。</p>
            </div>
            <div className="conversation__message is-system">
              <span className="conversation__message-label">系统记录</span>
              <p>角色 Agent 已完成 2 / 4 张卡片，写作 Agent 等待输入。</p>
            </div>
            <div className="conversation__message is-user">
              <span className="conversation__message-label">你 · 10:42</span>
              <p>先保留林晚的沉默。</p>
            </div>
          </div>

          <div className="conversation__ask">
            <div className="conversation__ask-head">
              <span className="status is-paused">需要你的决定</span>
              <span className="anno">ask-human · 1</span>
            </div>
            <h3>林晚在坡道下如何回应？</h3>
            <p>这个选择会影响第 2 章的冲突强度和角色关系。</p>
            <div className="conversation__choices">
              <button type="button" onClick={() => navigate('/w/plot')}>A　继续沉默</button>
              <button type="button" onClick={() => navigate('/w/plot')}>B　主动提问</button>
            </div>
          </div>

          <div className="conversation__composer">
            <textarea placeholder="告诉中心 Agent 下一步怎么做…" />
            <button type="button" className="btn btn--primary">发送指令</button>
          </div>
        </>
      )}
    </aside>
  );
}
