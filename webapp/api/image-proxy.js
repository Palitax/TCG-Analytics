import https from 'https';
import http from 'http';

function fetchWithRedirects(url, options, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const transport = url.startsWith('https') ? https : http;
    const req = transport.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        return fetchWithRedirects(redirectUrl, options, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.cardmarket.com/'
      }
    };

    const proxyRes = await fetchWithRedirects(decodedUrl, options);

    if (proxyRes.statusCode !== 200) {
      return res.status(proxyRes.statusCode).json({ error: `S3 returned HTTP ${proxyRes.statusCode}` });
    }

    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    proxyRes.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
