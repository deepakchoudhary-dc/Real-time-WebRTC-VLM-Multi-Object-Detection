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

  await t.test('Metrics & Per-Session CSRF Protection (N12)', async () => {
    // 1. Get metrics
    const getRes = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(getRes.status, 200);
    const metrics = await getRes.json();
    assert.ok('processed_frames' in metrics);
    assert.ok('median_latency_ms' in metrics);

    // 2. Fetch QR to obtain a valid per-session CSRF token
    const qrRes = await fetch(`${baseUrl}/api/qr`);
    const qrBody = await qrRes.json();
    const validCsrf = qrBody.csrfToken;

    // 3. Try reset without CSRF header -> Rejected 403
    const resetFail = await fetch(`${baseUrl}/api/reset-metrics`, { method: 'POST' });
    assert.equal(resetFail.status, 403);

    // 4. Reset with valid CSRF header -> Accepted 200
    const resetSuccess = await fetch(`${baseUrl}/api/reset-metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': validCsrf
      }
    });
    assert.equal(resetSuccess.status, 200);

    // 5. Re-using already consumed CSRF token -> Rejected 403 (single-use rotation)
    const resetReused = await fetch(`${baseUrl}/api/reset-metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': validCsrf
      }
    });
    assert.equal(resetReused.status, 403);
  });

  await stopApp();
});
