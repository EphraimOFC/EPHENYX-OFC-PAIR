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

import pairServerless from '../api/pair.js';
import qrServerless from '../api/qr.js';
import healthServerless from '../api/health.js';

function mockResponse(){return{headers:{},statusCode:200,body:null,setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}}

test('Vercel pairing function fails closed and never creates/export session credentials',()=>{
 const res=mockResponse();pairServerless({method:'GET',query:{number:'2348012345678'}},res);
 assert.equal(res.statusCode,503);assert.equal(res.body.code,'pairing_requires_persistent_host');assert.equal(res.headers['Cache-Control'],'no-store, no-cache, must-revalidate, private');
 const method=mockResponse();pairServerless({method:'POST'},method);assert.equal(method.statusCode,405);
});

test('Vercel QR function fails closed while preview health is explicit',()=>{
 const res=mockResponse();qrServerless({method:'GET'},res);assert.equal(res.statusCode,503);assert.equal(res.body.code,'qr_requires_persistent_host');
 const health=mockResponse();healthServerless({},health);assert.equal(health.statusCode,200);assert.equal(health.body.pairingEnabled,false);
});
