import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: false,
  noExternal: [/^(?!better-sqlite3$|node-pty$).*$/],
  external: [
    'better-sqlite3',
    'node-pty',
  ],
  esbuildOptions(options) {
    options.banner = {
      js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
    }
    options.define = {
      __filename: 'import.meta.filename',
      __dirname: 'import.meta.dirname',
    }
  },
})
