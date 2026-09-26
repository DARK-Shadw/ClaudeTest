import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build runs from any folder or static host.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
