import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();
const sessionsRoot = path.resolve('./qr_sessions');
const active = new Map();
const limits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 3;
const LIMIT_STORE_MAX = 10_000;
function rateLimited(ip) {
  const now = Date.now();
  for (const [key, entry] of limits) if (now - entry.start > WINDOW_MS) limits.delete(key);
  if (limits.size >= LIMIT_STORE_MAX && !limits.has(ip)) return true;
  const entry = limits.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) { entry.count = 0; entry.start = now; }
  entry.count++; limits.set(ip, entry);
  return entry.count > MAX_REQUESTS;
}
function cleanup(id, sock, dir) {
  const timer = active.get(id); if (timer) clearTimeout(timer);
  active.delete(id); try { sock?.ws?.close(); } catch {}
  try { const resolved = path.resolve(dir); if (resolved.startsWith(sessionsRoot + path.sep)) fs.rmSync(resolved, { recursive: true, force: true }); } catch {}
}
router.get('/', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ code: 'Too many QR requests. Wait 10 minutes.' });
  if (active.size >= 3) return res.status(503).json({ code: 'QR capacity full. Retry shortly.' });
  const id = randomUUID(); fs.mkdirSync(sessionsRoot, { recursive: true, mode: 0o700 });
  const dir = path.resolve(sessionsRoot, id);
  if (!dir.startsWith(sessionsRoot + path.sep)) return res.status(400).json({ code: 'Invalid session path.' });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let sock, sent = false;
  const timeout = setTimeout(() => { if (!sent) { sent = true; res.status(408).json({ code: 'QR generation timeout.' }); } cleanup(id, sock, dir); }, 30_000);
  active.set(id, timeout);
  req.on('aborted', () => cleanup(id, sock, dir));
  try {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, logger: pino({ level: 'silent' }), browser: Browsers.windows('Chrome'), printQRInTerminal: false, auth: state, markOnlineOnConnect: false, connectTimeoutMs: 30_000, defaultQueryTimeoutMs: 30_000, keepAliveIntervalMs: 20_000 });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !sent) {
        try {
          const data = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#FFFFFF' } });
          if (!sent) { sent = true; res.json({ qr: data, message: 'Scan in WhatsApp Linked Devices. Session credentials are not exported.', instructions: ['Open WhatsApp','Settings > Linked Devices','Link a Device','Scan this QR'] }); }
        } catch { if (!sent) { sent = true; clearTimeout(timeout); res.status(500).json({ code: 'QR generation failed.' }); } cleanup(id, sock, dir); }
      }
      if (connection === 'open') setTimeout(() => cleanup(id, sock, dir), 10_000);
      if (connection === 'close') { const code = lastDisconnect?.error?.output?.statusCode; if (code === 401 || code === DisconnectReason.loggedOut) cleanup(id, sock, dir); }
    });
  } catch (err) {
    clearTimeout(timeout); if (!sent) { sent = true; res.status(503).json({ code: 'QR service unavailable.' }); }
    console.error('QR generation failed:', err?.message || 'unknown'); cleanup(id, sock, dir);
  }
});
export default router;
