import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server API (see server/config.ts): 4748, beside the always-on service on 4747.
const apiPort = Number(process.env.MC_PORT ?? 4748);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/files': `http://127.0.0.1:${apiPort}`,
    },
  },
});
