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

function rateLimited(ip) {
  const now = Date.now();
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
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

router.get('/', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ code: 'Too many pairing requests. Wait 10 minutes and retry.' });
  if (active.size >= MAX_ACTIVE) return res.status(503).json({ code: 'Pairing capacity is full. Try again shortly.' });

  const raw = String(req.query.number || '').replace(/[^0-9]/g, '');
  if (!raw) return res.status(400).json({ code: 'Enter your phone number with country code.' });
  const parsed = pn('+' + raw);
  if (!parsed.isValid()) return res.status(400).json({ code: 'Invalid international phone number.' });
  const number = parsed.getNumber('e164').replace('+', '');
  const id = randomUUID();
  const dir = path.join(sessionsRoot, id);
  fs.mkdirSync(dir, { recursive: true });

  let sock;
  let done = false;
  const finish = (status, payload) => {
    if (done || res.headersSent) return;
    done = true; res.status(status).json(payload);
  };
  const expire = setTimeout(() => cleanup(id, sock, dir), 90_000);
  active.set(id, expire);
  const reqTimeout = setTimeout(() => finish(504, { code: 'Pairing code timed out. Retry.' }), 35_000);
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
      if (connection === 'open') {
        // This endpoint is only a pairing-code generator. It does not export session credentials.
        setTimeout(() => cleanup(id, sock, dir), 10_000);
      }
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
