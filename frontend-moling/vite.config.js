import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 墨灵前端壳：暂不配 proxy，等后端定端口后再加 server.proxy
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
