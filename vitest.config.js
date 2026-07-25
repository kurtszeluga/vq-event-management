import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/client/setup.js'],
    include: ['tests/client/**/*.test.{js,jsx}']
  }
});
