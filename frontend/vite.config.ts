/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // redirect.html ist die Bridge-Seite für die stille Anmeldung und bleibt ohne App-Code klein.
      input: { main: 'index.html', redirect: 'redirect.html' },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
  },
});
