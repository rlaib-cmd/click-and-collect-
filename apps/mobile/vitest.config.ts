import { defineConfig } from 'vitest/config';

// Tests des modules TypeScript purs (sans React Native).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
