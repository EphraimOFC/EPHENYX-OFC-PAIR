import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pair = fs.readFileSync(new URL('../pair.js', import.meta.url), 'utf8');
const qr = fs.readFileSync(new URL('../qr.js', import.meta.url), 'utf8');

test('pair route validates phone input before creating session folder', () => {
  assert.match(pair, /const parsed = pn\('\+' \+ raw\)/);
  assert.match(pair, /const id = randomUUID\(\)/);
  assert.match(pair, /path\.join\(sessionsRoot, id\)/);
  assert.doesNotMatch(pair, /let dirs = '\.\/' \+ num/);
});

test('pair and QR handlers never export creds files through WhatsApp', () => {
  assert.doesNotMatch(pair, /sendMessage\([^)]*,\s*\{\s*document/);
  assert.doesNotMatch(qr, /sendMessage\([^)]*,\s*\{\s*document/);
  assert.doesNotMatch(pair, /fileName:\s*['"]creds\.json['"]/);
  assert.doesNotMatch(qr, /fileName:\s*['"]creds\.json['"]/);
});

test('pair endpoints include rate limits, active-session caps, bounded cleanup', () => {
  assert.match(pair, /MAX_REQUESTS/);
  assert.match(pair, /MAX_ACTIVE/);
  assert.match(pair, /90_000/);
  assert.match(qr, /rateLimited/);
  assert.match(qr, /30_000/);
});
