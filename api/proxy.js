const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwAc64C_9FGkHQwbgMXq_r9Y_r4o8bZEw1jRUQZ0g-0Hvf3f4b5W1XCZ6fCET25hbSulQ/exec";

// Abort after 8 seconds — Google cold starts can hang indefinitely without this
function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let googleRes;

    if (req.method === 'GET') {
      googleRes = await fetchWithTimeout(SCRIPT_URL, { redirect: 'follow' }, 8000);
    } else if (req.method === 'POST') {
      googleRes = await fetchWithTimeout(SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(req.body),
      }, 10000); // slightly longer for writes
    } else {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const text = await googleRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Apps Script returns an HTML error page on uncaught exceptions —
      // surface its text so the real error reaches the client
      const stripped = text
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return res.status(502).json({
        ok: false,
        error: 'Apps Script error: ' + (stripped.slice(0, 300) || `HTTP ${googleRes.status}`)
      });
    }
    return res.status(200).json(data);

  } catch (err) {
    // Timeout or network error — return structured error so client falls back to cache
    const isTimeout = err.name === 'AbortError';
    return res.status(isTimeout ? 504 : 500).json({
      ok: false,
      error: isTimeout ? 'timeout' : err.message
    });
  }
}
