import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/server/vitest.config.ts',
      'apps/web/vitest.config.ts',
    ],
  },
})
