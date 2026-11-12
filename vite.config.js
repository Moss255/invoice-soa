import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built `dist/` works from any static host or sub-folder.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.js'],
    // Pure logic runs in Node; component tests opt into a DOM with
    // `// @vitest-environment happy-dom` at the top of the file.
    environment: 'node',
    // Cap each test worker's heap so a runaway test fails fast instead of eating the machine's RAM.
    execArgv: ['--max-old-space-size=1024'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
