import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@akari/server',
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts',
        'src/plugins/**',
        'src/routes/**',
      ],
    },
  },
})
