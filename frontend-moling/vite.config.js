import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 后端已定端口（10/2）：Hono + Bun，监听 :3000
 * 入口文件 agent/my-app/src/index.ts，路由三族：
 *   /api/novels、/api/novels/:id/generation、/api/worlds
 *
 * 所以这里补上 server.proxy —— DESIGN.md 第七节约定：
 * 前端一律 fetch('/api/...') 相对路径，禁写死绝对地址。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
});
