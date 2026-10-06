import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 后端只有一个：`agent/storage/server.ts`（Bun.serve），监听 :3000。
 * 正式接口清单见 `src/api/endpoints.js`；页面实际调用的是 `src/api/client.js`。
 * `agent/my-app/src/index.ts` 是 storage server 内部复用的业务门面，不单独监听端口。
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
