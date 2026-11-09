import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The core is consumed from source: no build step, and Vite's HMR covers both packages.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Skips fs.realpath, which Windows refuses for some folders (Downloads, protected folders).
    preserveSymlinks: true,
    alias: { '@flowcode/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
});
