import { defineConfig } from 'vite';

// 저장(localStorage)은 주소(포트)마다 따로라서 개발 서버 포트를 고정한다.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
