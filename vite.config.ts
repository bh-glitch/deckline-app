import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo>/; local dev stays at /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.BASE_PATH ?? '/deckline-app/' : '/',
  plugins: [react()],
  worker: { format: 'es' },
}));
