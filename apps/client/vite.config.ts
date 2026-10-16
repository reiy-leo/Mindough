import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 开发时固定端口；TAURI_ENV_PLATFORM 由 tauri cli 注入
const host = process.env.TAURI_DEV_HOST;

// Web 端 SQLite（Turso wasm，多线程）需要 SharedArrayBuffer → 页面必须跨源隔离。
// 用 COEP: credentialless 而不是 require-corp：用户贴的外站图片（海报、头像）不带 CORP 头也能显示。
// 线上由 Worker 静态资源的 public/_headers 带同样的头。
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    headers: isolation,
    // 本地联调登录：/api 与 /auth 转给 wrangler dev（pnpm --filter server dev，:8787）。
    // changeOrigin 让 Worker 看到 localhost:8787，Google 回调地址就是 http://localhost:8787/auth/callback
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/auth': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  preview: { port: 4173, headers: isolation },
  // wasm 包自带 worker 与 .wasm 资源，不让 vite 预打包
  optimizeDeps: { exclude: ['@tursodatabase/database-wasm', '@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
