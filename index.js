import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pairRouter from './pair.js';
import qrRouter from './qr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.disable('x-powered-by');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxyHops) && proxyHops >= 0 && proxyHops <= 3) app.set('trust proxy', proxyHops);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pair', pairRouter);
app.use('/qr', qrRouter);
app.get('/health', (_req, res) => res.json({ ok: true, service: 'EPHENYX Pair Portal', mode: 'persistent-host', pairingEnabled: true }));
app.get('/', (_req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
  res.status(404).send('Pair portal UI missing.');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('EPHENYX Pair Portal listening on ' + PORT));
