import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // Les tests HTTP partagent une même base : un fichier à la fois.
    fileParallelism: false,
  },
});
