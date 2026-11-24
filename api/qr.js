export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ code: 'method_not_allowed' });
  return res.status(503).json({
    code: 'qr_requires_persistent_host',
    message: 'QR pairing is disabled on Vercel serverless. Use the long-running EPHENYX Pair host.'
  });
}
