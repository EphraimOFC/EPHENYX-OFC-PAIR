export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    return res.status(405).json({ code: 'method_not_allowed' });
  }
  // Serverless requests cannot reliably keep a WhatsApp pairing socket alive.
  // Use the long-running Express host (Render/VPS) for pairing; never run the
  // legacy phone-number directory/session implementation in this function.
  return res.status(503).json({
    code: 'pairing_requires_persistent_host',
    message: 'Pairing is disabled on Vercel serverless. Use the long-running EPHENYX Pair host.'
  });
}
