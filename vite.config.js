import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for the project. See https://vitejs.dev/config/ for details.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  build: {
    outDir: 'dist'
  }
});
