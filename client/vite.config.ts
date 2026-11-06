import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API is reached through this proxy, so the app and the API share one origin and its cookies.
const api = process.env.API_URL ?? 'http://localhost:3000';
const proxy = Object.fromEntries(['/auth', '/apps', '/url'].map((path) => [path, { target: api }]));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy },
  test: { environment: 'jsdom', setupFiles: ['test/setup.ts'] },
});
