import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 角色页：cast.json → protagonists[]（CharacterAgent 产，stage=character）。
 * 一张人物卡七要素：声线/想要/愿付/缺的/秘密 + 不可变印记数。
 * 后端字段是真名（voice/want/cost/need/secret/immutable[]），卡上中英对照入注。
 * secret 允许缺席（角色自己还没开口），渲染按有无来。
 */
const CAST = [
  {
    name: '周砚',
    role: '男主',
    voice: '句子短，常用「嗯」「行」这类单字回应。心里有事的时候会重复对方最后一个词。从不说「我爱你」，最重的话是「我在」。',
    want: '在第一段人生里，让同班的苏晴注意到他——他喜欢苏晴这件事全校都知道。',
    cost: '把每天和林晚一起走的那二十分钟拆开，绕路去苏晴常走的坡道；他愿意担，且从没觉得那是代价。',
    need: '一个不用他做任何事、就已经在那里等他的人。他从小就有，但他一直没看见。',
    secret: '一直偷偷收着林晚从小到大塞在他书包里的东西——一颗糖、一张卷子角、一片榕树叶。',
    immutable: 5,
    anchor: '左手虎口有一道浅疤，初二削铅笔削的，一直没退',
  },
  {
    name: '林晚',
    role: '女主',
    voice: '话极少，句子极短。想问什么就直接问，不加「那个」「不好意思」。撒娇不用语气词，只是把手里东西递过去。从不解释自己的行为。',
    want: '让周砚每天放学都在校门口等她——已经等了十几年，哪怕他绕路追人，她也只是站在原地等。',
    cost: '愿意一个人吃掉所有「他今天又没来」的晚上，愿意在隔街空房子里待到十一点，愿意不问他为什么。',
    need: '一个不会走的人。所有的安全感都押在同一个人身上，她要的不是甜，是「确定」。',
    immutable: 5,
    anchor: '头发永远扎得很紧，一根碎发都不放下来',
  },
];

export default function Cast() {
  return (
    <main className="wb-page enter">
      <BlockTitle mark="色" name="角色" />

      <div className="cast__grid">
        {CAST.map((p) => (
          <article className="card char" key={p.name}>
            <div className="char__head">
              <span className="char__name">{p.name}</span>
              <span className="chip">{p.role}</span>
            </div>

            <div className="char__fields">
              <div className="field">
                <p className="field__k" data-en="voice">声线</p>
                <p className="field__v field__v--prose">{p.voice}</p>
              </div>
              <div className="field">
                <p className="field__k" data-en="want">想要</p>
                <p className="field__v">{p.want}</p>
              </div>
              <div className="field">
                <p className="field__k" data-en="cost">愿付</p>
                <p className="field__v">{p.cost}</p>
              </div>
              <div className="field">
                <p className="field__k" data-en="need">缺的</p>
                <p className="field__v">{p.need}</p>
              </div>
              {p.secret && (
                <div className="field">
                  <p className="field__k" data-en="secret">秘密</p>
                  <p className="field__v">{p.secret}</p>
                </div>
              )}
              <div className="field">
                <p className="field__k" data-en="immutable">不可变印记 ×{p.immutable}</p>
                <p className="anno">锚点举例：{p.anchor}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
