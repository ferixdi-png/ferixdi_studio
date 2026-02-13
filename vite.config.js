import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'app',
  base: '/ferixdi_studio/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'app/src'),
      '@engine': resolve(__dirname, 'app/engine'),
      '@data': resolve(__dirname, 'app/data'),
      '@spec': resolve(__dirname, 'app/spec'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
