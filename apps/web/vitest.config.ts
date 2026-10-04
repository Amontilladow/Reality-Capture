import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Separate from vite.config.ts (rather than merged into it) so `vitest`
// doesn't have to parse/apply the dev-server proxy and production
// rollupOptions.input that only make sense for `vite`/`vite build` --
// mergeConfig still reuses the same plugins/resolve/alias setup so test
// imports resolve identically to the real app (same @engineeringos/types
// CJS interop fix, same `@/` alias).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    },
  }),
);
