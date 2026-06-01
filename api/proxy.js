const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyldKl8FJ9aV9oj1S7tBZ-Xnz7G3BiQ3CGB_jRrN3GEzJtUSV6BYsPAjecCMTXCpcCw0Q/exec";

export default async function handler(req, res) {
  // Allow requests from your Vercel frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let googleRes;

    if (req.method === 'GET') {
      // Load state
      googleRes = await fetch(SCRIPT_URL, { redirect: 'follow' });
    } else if (req.method === 'POST') {
      // Write action
      googleRes = await fetch(SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(req.body),
      });
    } else {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const data = await googleRes.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
