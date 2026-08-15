'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../../server/app');

let server;
let baseUrl;

function startApp() {
  return new Promise((resolve) => {
    const app = createApp();
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopApp() {
  return new Promise((resolve) => {
    if (server.closeAllConnections) {
      server.closeAllConnections();
    }
    server.close(resolve);
  });
}

test('Integration Routes - Native Suite', async (t) => {
  await startApp();

  await t.test('Health endpoint', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'healthy');
    assert.ok(typeof body.uptime === 'number');
  });

  await t.test('QR Code and Token Generation (N05)', async () => {
    const res = await fetch(`${baseUrl}/api/qr`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.roomCode);
    assert.ok(body.desktopToken);
    assert.ok(body.token); // phoneToken
    assert.notEqual(body.desktopToken, body.token);
    assert.ok(body.qr);
    assert.ok(body.url);
    assert.match(body.url, /\/phone\?room=[A-HJ-NP-Z2-9]{6}&token=[a-f0-9]{32}/);
    assert.ok(body.csrfToken);
  });

  await t.test('Security Headers & CSP (N22)', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('content-security-policy'));
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });

  await t.test('Malformed JSON Body returns 400 (N33)', async () => {
    const res = await fetch(`${baseUrl}/api/reset-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken json'
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /malformed/i);
  });

  await t.test('Metrics & Consecutive CSRF Resets with Refreshed Tokens (G01, G02)', async () => {
    // 1. Get metrics (total_frames is removed, G01)
    const getRes = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(getRes.status, 200);
    const metrics = await getRes.json();
    assert.ok('processed_frames' in metrics);
    assert.equal('total_frames' in metrics, false);

    // 2. Fetch QR to obtain initial CSRF token
    const qrRes = await fetch(`${baseUrl}/api/qr`);
    const qrBody = await qrRes.json();
    let currentCsrf = qrBody.csrfToken;

    // 3. First reset with valid CSRF header -> 200 + returns refreshed token
    const reset1 = await fetch(`${baseUrl}/api/reset-metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': currentCsrf
      }
    });
    assert.equal(reset1.status, 200);
    const reset1Body = await reset1.json();
    assert.ok(reset1Body.csrfToken);
    currentCsrf = reset1Body.csrfToken;

    // 4. Consecutive second reset with refreshed token -> 200 (G02 fix)
    const reset2 = await fetch(`${baseUrl}/api/reset-metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': currentCsrf
      }
    });
    assert.equal(reset2.status, 200);
  });

  await stopApp();
});
