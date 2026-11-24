import express from 'express';
import pino from 'pino';
import { randomUUID } from 'crypto';
import { makeWASocket, useMultiFileAuthState, delay, Browsers, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const sessionsRoot = path.resolve('./pair_sessions');
const active = new Map();
const limits = new Map();
const MAX_ACTIVE = 3;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 4;
const LIMIT_STORE_MAX = 10_000;

function rateLimited(ip) {
  const now = Date.now();
  for (const [key, entry] of limits) if (now - entry.start > WINDOW_MS) limits.delete(key);
  if (limits.size >= LIMIT_STORE_MAX && !limits.has(ip)) return true;
  const current = limits.get(ip) || { count: 0, start: now };
  if (now - current.start > WINDOW_MS) { current.count = 0; current.start = now; }
  current.count++;
  limits.set(ip, current);
  return current.count > MAX_REQUESTS;
}
function cleanup(id, sock, dir) {
  const timer = active.get(id);
  if (timer) clearTimeout(timer);
  active.delete(id);
  try { sock?.ws?.close(); } catch {}
  try {
    const resolved = path.resolve(dir);
    if (resolved.startsWith(sessionsRoot + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
  } catch {}
}

router.post('/', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ code: 'Too many pairing requests. Wait 10 minutes and retry.' });
  if (active.size >= MAX_ACTIVE) return res.status(503).json({ code: 'Pairing capacity is full. Try again shortly.' });

  const raw = String(req.body?.number || '').replace(/[^0-9]/g, '');
  if (!raw || raw.length > 15) return res.status(400).json({ code: 'Enter your phone number with country code.' });
  const parsed = pn('+' + raw);
  if (!parsed.isValid()) return res.status(400).json({ code: 'Invalid international phone number.' });
  const number = parsed.getNumber('e164').replace('+', '');
  const id = randomUUID();
  fs.mkdirSync(sessionsRoot, { recursive: true, mode: 0o700 });
  const dir = path.resolve(sessionsRoot, id);
  if (!dir.startsWith(sessionsRoot + path.sep)) return res.status(400).json({ code: 'Invalid session path.' });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  let sock;
  let done = false;
  const finish = (status, payload) => {
    if (done || res.headersSent) return;
    done = true; res.status(status).json(payload);
  };
  const expire = setTimeout(() => cleanup(id, sock, dir), 90_000);
  active.set(id, expire);
  const reqTimeout = setTimeout(() => finish(504, { code: 'Pairing code timed out. Retry.' }), 35_000);
  req.on('aborted', () => { clearTimeout(reqTimeout); cleanup(id, sock, dir); });
  try {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version, auth: state, printQRInTerminal: false,
      logger: pino({ level: 'silent' }), browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false, connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: 30_000, keepAliveIntervalMs: 20_000,
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') setTimeout(() => cleanup(id, sock, dir), 10_000);
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut || code === 401) cleanup(id, sock, dir);
      }
    });
    await delay(2500);
    if (state.creds.registered) {
      clearTimeout(reqTimeout); finish(409, { code: 'Session already registered. Start a fresh request.' });
      cleanup(id, sock, dir); return;
    }
    const pairingCode = await sock.requestPairingCode(number);
    const formatted = pairingCode?.match(/.{1,4}/g)?.join('-') || pairingCode;
    clearTimeout(reqTimeout);
    finish(200, { code: formatted, message: 'Use WhatsApp Linked Devices > Link with phone number. This site does not send or export session credentials.' });
  } catch (err) {
    clearTimeout(reqTimeout);
    console.error('Pairing request failed:', err?.message || 'unknown error');
    finish(503, { code: 'Pairing unavailable. Please retry shortly.' });
    cleanup(id, sock, dir);
  }
});
export default router;
