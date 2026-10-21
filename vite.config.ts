import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'development-csp',
    apply: 'serve',
    // React refresh injects an inline preamble; keep this exception out of packaged builds.
    transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self' blob: data:", "connect-src 'self' blob: data: ws://localhost:5173 http://localhost:5173"),
  }],
  build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome120' },
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
