export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send("Missing url parameter");
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    
    // Safety check: Only allow Cardmarket domains
    if (!decodedUrl.includes('cardmarket.com') && !decodedUrl.includes('cardmarket.co')) {
      return res.status(403).send("Forbidden: Only Cardmarket images allowed");
    }

    // Perform server-side fetch with desktop headers to bypass bot blocks
    const response = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch image: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    
    // Cache the image on Vercel CDN for 1 day
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    return res.status(500).send(`Error: ${error.message}`);
  }
}
