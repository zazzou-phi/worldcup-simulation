import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: '/',
  resolve: {
    alias: {
      '@shared': join(__dirname, '../engine/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE ?? 'private'),
  },
});
