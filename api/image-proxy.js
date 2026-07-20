const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
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
    const transport = decodedUrl.startsWith('https') ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.cardmarket.com/'
      }
    };

    transport.get(decodedUrl, options, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        return res.status(proxyRes.statusCode).json({ error: `S3 returned HTTP ${proxyRes.statusCode}` });
      }

      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      proxyRes.pipe(res);
    }).on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
