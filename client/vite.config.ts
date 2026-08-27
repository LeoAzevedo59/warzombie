import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  // id do build injetado nas URLs de assets (sons/modelos) para furar o cache do navegador a cada deploy
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@shared': new URL('../shared', import.meta.url).pathname,
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // em dev o Vite serve o client e repassa API/WS para o server Express na 3000
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET.replace(/^http/, 'ws'), ws: true },
    },
  },
});
