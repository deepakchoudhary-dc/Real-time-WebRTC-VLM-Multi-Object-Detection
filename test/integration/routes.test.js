'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../../server/app');
const { getCsrfToken } = require('../../server/security');

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

  await t.test('QR Code and Room Generation', async () => {
    const res = await fetch(`${baseUrl}/api/qr`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.roomCode);
    assert.ok(body.token);
    assert.ok(body.qr);
    assert.ok(body.url);
    assert.match(body.url, /\/phone\?room=[A-HJ-NP-Z2-9]{6}&token=[a-f0-9]{32}/);
    assert.ok(body.csrfToken);
  });

  await t.test('ICE Config endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/ice-config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.iceServers));
    assert.ok(body.iceServers.length > 0);
  });

  await t.test('Metrics & CSRF-protected Reset', async () => {
    // 1. Get metrics
    const getRes = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(getRes.status, 200);
    const metrics = await getRes.json();
    assert.ok('processed_frames' in metrics);
    assert.ok('median_latency_ms' in metrics);

    // 2. Try reset without CSRF token -> Rejected 403 (F-05 fix)
    const resetFail = await fetch(`${baseUrl}/api/reset-metrics`, { method: 'POST' });
    assert.equal(resetFail.status, 403);
    const failBody = await resetFail.json();
    assert.match(failBody.error, /CSRF/i);

    // 3. Reset with valid CSRF token -> Accepted 200
    const validCsrf = getCsrfToken();
    const resetSuccess = await fetch(`${baseUrl}/api/reset-metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': validCsrf
      }
    });

    assert.equal(resetSuccess.status, 200);
    const successBody = await resetSuccess.json();
    assert.match(successBody.message, /reset/i);
  });

  await t.test('Static page routes', async () => {
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    const indexText = await indexRes.text();
    assert.match(indexText, /WebRTC Object Detection/);

    const phoneRes = await fetch(`${baseUrl}/phone`);
    assert.equal(phoneRes.status, 200);
    const phoneText = await phoneRes.text();
    assert.match(phoneText, /Wireless Camera/);
  });

  await stopApp();
});
