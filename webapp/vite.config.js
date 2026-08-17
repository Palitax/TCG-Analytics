import { defineConfig } from 'vite';
import https from 'https';
import http from 'http';

function imageProxyPlugin() {
  return {
    name: 'image-proxy-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/image-proxy', (req, res) => {
        const urlObj = new URL(req.url, 'http://localhost');
        const targetUrl = urlObj.searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }
        try {
          const decoded = decodeURIComponent(targetUrl);
          const transport = decoded.startsWith('https') ? https : http;
          const proxyReq = transport.get(decoded, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Referer': 'https://www.cardmarket.com/'
            }
          }, (proxyRes) => {
            res.statusCode = proxyRes.statusCode || 200;
            res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
            proxyRes.pipe(res);
          });
          proxyReq.on('error', (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [imageProxyPlugin()],
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
