import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      // Explicit entry point so dev-only HTML (dev-harness/) can never be
      // picked up by Vite's default multi-page auto-discovery, regardless
      // of where such files live in the project.
      input: path.resolve(__dirname, 'index.html'),
    },
    commonjsOptions: {
      // @engineeringos/types is a CJS-compiled workspace package (pnpm
      // symlink, not a node_modules registry install). Rollup's commonjs
      // plugin only converts node_modules/** by default, so without this,
      // any file importing a runtime VALUE (not just a type) from it —
      // e.g. PROJECT_PHASES — fails at production build time with
      // "is not exported", even though `vite dev` and `tsc` both work
      // fine (type-only imports are erased before this ever matters).
      include: [/node_modules/, /packages\/types/],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
