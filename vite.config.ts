import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: { port: 5173 },
});
