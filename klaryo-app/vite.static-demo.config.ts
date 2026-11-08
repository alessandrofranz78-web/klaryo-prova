import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Build separata dalla app con server. Non avvia Express e non include il guard di produzione. */
export default defineConfig({
  root: path.join(root, 'static-demo'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.join(root, 'dist-static-demo'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
