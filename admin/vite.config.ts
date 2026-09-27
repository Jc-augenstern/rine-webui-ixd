import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: '/admin/',
  define: { __IXD_FRONTEND_URL__: JSON.stringify(command === 'serve' ? process.env.APP_PUBLIC_URL || 'http://127.0.0.1:5173/' : '/') },
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1', port: 5174, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
}));
