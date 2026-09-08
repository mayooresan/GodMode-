import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In development the dashboard runs on :5173 and proxies to the engine on
 * :8080; in production it is built to static files that the Fastify server
 * itself serves, so there is only ever one port to expose on the droplet.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
        // SSE must not be buffered by the dev proxy.
        ws: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
