import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built `dist/` works from any static host or sub-folder.
  base: './',
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Emit the PDF.js worker (pdf.worker.min.mjs) as .js: some static servers, such as
        // nginx on Coolify, don't map .mjs to a JavaScript MIME type, and browsers refuse
        // to start a module worker served as application/octet-stream.
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
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
