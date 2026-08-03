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
  optimizeDeps: {
    // @engineeringos/types is a CJS-compiled workspace package served
    // directly from disk (via /@fs/) rather than pre-bundled, since Vite
    // treats linked workspace packages as project source, not a
    // dependency, by default. A native `import { X } from '@engineeringos/types'`
    // against that raw CJS file fails at dev-server time with "does not
    // provide an export named X" for any runtime value (not type) import
    // -- confirmed by hand: the whole app fails to mount, silently, with
    // no console error, because this happens inside main.tsx's own import
    // chain before React ever renders anything. Forcing it through
    // esbuild's pre-bundler here gives it the same CJS->ESM interop real
    // node_modules dependencies get automatically. (build.commonjsOptions
    // below is the equivalent fix for `vite build`, which uses Rollup
    // instead -- the two are separate pipelines and neither covers the
    // other.)
    include: ['@engineeringos/types'],
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
