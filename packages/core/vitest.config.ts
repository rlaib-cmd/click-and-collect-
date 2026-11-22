import { defineConfig } from 'vitest/config';

// Les règles métier portent l'argent et les créneaux : couverture exigée.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/menu.ts'],
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
