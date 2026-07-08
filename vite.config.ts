import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 14510,
    strictPort: false
  },
  test: {
    environment: 'node'
  }
});
