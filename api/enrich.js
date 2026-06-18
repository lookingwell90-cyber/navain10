/**
 * Navain AI — Enrich Proxy
 * POST /api/enrich
 * Body: { url: "https://www.yelp.com/biz/..." }
 * Returns: { phone, city, province, industry, source }
 *
 * Runs server-side on Vercel so no CORS issues and full HTML is fetched
 * with realistic browser headers that bypass basic bot-detection.
 */

export default async function handler(req, res) {
  // Allow requests from any origin (your Firebase-hosted admin.html)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }

  // Only enrich Yelp or Yellow Pages links
  const isYelp = url.includes('yelp.com') || url.includes('yelp.ca');
  const isYP   = url.includes('yellowpages.ca') || url.includes('yp.ca') || url.includes('yellowpages.com');

  if (!isYelp && !isYP) {
    // Regular website — return it as-is, no enrichment needed
    return res.status(200).json({ skip: true, reason: 'regular_website' });
  }

  try {
    const html = await fetchPage(url);
    if (!html) {
      return res.status(200).json({ skip: true, reason: 'fetch_failed' });
    }

    const data = isYelp ? extractYelp(html) : extractYP(html);
    return res.status(200).json({ ...data, source: isYelp ? 'yelp' : 'yp' });

  } catch (err) {
    console.error('Enrich error:', err.message);
    return res.status(200).json({ skip: true, reason: 'error', detail: err.message });
  }
}

// ─── Fetch with realistic browser headers ────────────────────────────────────

async function fetchPage(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-CA,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const text = await response.text();
    return text && text.length > 200 ? text : null;
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

// ─── Yelp extractor ──────────────────────────────────────────────────────────

function extractYelp(html) {
  const result = { phone: '', city: '', province: '', industry: '' };

  // 1. JSON-LD (most reliable on Yelp)
  const jsonLdBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block[1].trim());
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (!result.phone && entry.telephone) result.phone = entry.telephone;
        if (entry.address) {
          if (!result.city && entry.address.addressLocality) result.city = entry.address.addressLocality;
          if (!result.province && entry.address.addressRegion) result.province = entry.address.addressRegion;
        }
        if (!result.industry) {
          if (entry.servesCuisine) result.industry = Array.isArray(entry.servesCuisine) ? entry.servesCuisine[0] : entry.servesCuisine;
          else if (entry.knowsAbout) result.industry = Array.isArray(entry.knowsAbout) ? entry.knowsAbout[0] : entry.knowsAbout;
        }
      }
    } catch (_) {}
  }

  // 2. Yelp embeds data in a __yelp_data__ or window.__data__ script tag
  if (!result.phone || !result.city) {
    const dataScript = html.match(/window\.__yelp_data__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i)
                    || html.match(/window\.__data__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i);
    if (dataScript) {
      try {
        const data = JSON.parse(dataScript[1]);
        const biz = deepFind(data, 'businessPage') || deepFind(data, 'business') || {};
        if (!result.phone && biz.phone) result.phone = biz.phone;
        if (!result.city && biz.location?.city) result.city = biz.location.city;
        if (!result.province && biz.location?.state) result.province = biz.location.state;
      } catch (_) {}
    }
  }

  // 3. Regex fallbacks on raw HTML
  if (!result.phone) {
    const m = html.match(/"phone"\s*:\s*"([^"]+)"/)
           || html.match(/"telephone"\s*:\s*"([^"]+)"/)
           || html.match(/href="tel:([^"]+)"/);
    if (m) result.phone = m[1];
  }
  if (!result.city) {
    const m = html.match(/"addressLocality"\s*:\s*"([^"]+)"/);
    if (m) result.city = m[1];
  }
  if (!result.province) {
    const m = html.match(/"addressRegion"\s*:\s*"([^"]+)"/);
    if (m) result.province = m[1];
  }
  if (!result.industry) {
    const m = html.match(/"category"\s*:\s*"([^"]+)"/)
           || html.match(/aria-label="([^"]+)" class="[^"]*category/i);
    if (m) result.industry = m[1];
  }

  return result;
}

// ─── Yellow Pages extractor ──────────────────────────────────────────────────

function extractYP(html) {
  const result = { phone: '', city: '', province: '', industry: '' };

  // 1. JSON-LD
  const jsonLdBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block[1].trim());
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (!result.phone && entry.telephone) result.phone = entry.telephone;
        if (entry.address) {
          if (!result.city && entry.address.addressLocality) result.city = entry.address.addressLocality;
          if (!result.province && entry.address.addressRegion) result.province = entry.address.addressRegion;
        }
      }
    } catch (_) {}
  }

  // 2. YP-specific meta tags
  if (!result.phone) {
    const m = html.match(/<span[^>]*class="[^"]*phone[^"]*"[^>]*>([^<]+)<\/span>/i)
           || html.match(/href="tel:([^"]+)"/i)
           || html.match(/"phone"\s*:\s*"([^"]+)"/i)
           || html.match(/(\(\d{3}\)\s*\d{3}[- ]\d{4})/);
    if (m) result.phone = m[1].trim();
  }

  if (!result.city) {
    const m = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)
           || html.match(/<span[^>]*class="[^"]*locality[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (m) result.city = m[1].trim();
  }

  if (!result.province) {
    const m = html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)
           || html.match(/<span[^>]*class="[^"]*region[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (m) result.province = m[1].trim();
  }

  if (!result.industry) {
    const m = html.match(/"category"\s*:\s*"([^"]+)"/i)
           || html.match(/<span[^>]*class="[^"]*category[^"]*"[^>]*>([^<]+)<\/span>/i)
           || html.match(/"businessType"\s*:\s*"([^"]+)"/i);
    if (m) result.industry = m[1].trim();
  }

  return result;
}

// ─── Utility: recursively find a key in nested object ────────────────────────

function deepFind(obj, key, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;
  if (obj[key] !== undefined) return obj[key];
  for (const v of Object.values(obj)) {
    const found = deepFind(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}
