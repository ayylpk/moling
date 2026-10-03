/**
 * Hono 应用入口 —— package.json 里 "dev": "bun run --hot src/index.ts" 指向的就是这里。
 *
 * 这一层只做两件事：注册 controller、决定监听端口。
 * 业务代码一律不写在这。
 *
 * 路由分两族：
 *   /api/worlds          世界观（历史路径，保留不动）
 *   /api/novels          小说本身 —— 整库的根
 *   /api/novels/:id/...  挂在某本小说下的全部内容
 *
 * 第二族下面有七个子域，全部以 novelId 开头。这是有意的：
 * 没有 novelId 就没法把任何一次查询限定在一本小说里。
 */
import { Hono } from 'hono'
import { storyPlannerController } from './controller/storyPlannerController'
import { novelController } from './controller/novelController'
import { generationController } from './controller/generationController'
import { characterController } from './controller/characterController'
import { locationController } from './controller/locationController'
import { volumeController } from './controller/volumeController'
import { outlineController } from './controller/outlineController'
import { chapterController } from './controller/chapterController'
import { actorDecisionController } from './controller/actorDecisionController'

const app = new Hono()

app.get('/', (c) => c.text('墨灵 api 运行中'))

// 世界观
app.route('/api/worlds', storyPlannerController)

// 小说本身
app.route('/api/novels', novelController)

// 以下全部挂在某本小说下面。挂载顺序不影响匹配（路径长度不同），
// 但按依赖从上到下排 —— 上游在前，读代码时跟流水线顺序一致。
app.route('/api/novels/:novelId/generation', generationController)
app.route('/api/novels/:novelId/characters', characterController)
app.route('/api/novels/:novelId/locations', locationController)
app.route('/api/novels/:novelId/volumes', volumeController)
app.route('/api/novels/:novelId/outline', outlineController)
app.route('/api/novels/:novelId/chapters', chapterController)
app.route('/api/novels/:novelId/decisions', actorDecisionController)

// bun 直接跑这个文件就会起 HTTP 服务（默认 http://localhost:3000）
export default { port: 3000, fetch: app.fetch }
