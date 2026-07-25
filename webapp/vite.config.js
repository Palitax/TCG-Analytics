import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/supabase-proxy': {
        target: 'https://api-supabase.rohdedigital.de',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase-proxy/, '')
      }
    }
  }
});
