import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      include: ['packages/**/*.test.ts', 'tests/integration/*.test.ts'],
      environment: 'node',
      globals: false
    }
  }
]);
