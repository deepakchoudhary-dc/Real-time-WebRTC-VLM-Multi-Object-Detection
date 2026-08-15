'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isOriginAllowed, getValidHost, getCsrfToken, verifyCsrfToken, rotateCsrfSecret } = require('../../server/security');

test('Security - Origin validation', () => {
  // Local origins
  assert.equal(isOriginAllowed('http://localhost:3000'), true);
  assert.equal(isOriginAllowed('https://localhost:3443'), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:3000'), true);

  // LAN IP ranges
  assert.equal(isOriginAllowed('https://192.168.1.50:3443'), true);
  assert.equal(isOriginAllowed('https://10.0.0.2:3443'), true);
  assert.equal(isOriginAllowed('https://172.20.10.3:3443'), true);

  // Null or undefined origin (same-origin requests)
  assert.equal(isOriginAllowed(null), true);
  assert.equal(isOriginAllowed(undefined), true);
  assert.equal(isOriginAllowed(''), true);

  // Disallowed external origin
  assert.equal(isOriginAllowed('https://evil-attacker.com'), false);
  assert.equal(isOriginAllowed('https://malicious.org:3443'), false);
});

test('Security - Host header validation', () => {
  const reqLocal = { get: () => 'localhost:3443', headers: {} };
  assert.equal(getValidHost(reqLocal), 'localhost:3443');

  const reqLan = { get: () => '192.168.1.100:3443', headers: {} };
  assert.equal(getValidHost(reqLan), '192.168.1.100:3443');

  const reqEvil = { get: () => 'evil.attacker.com', headers: {} };
  assert.equal(getValidHost(reqEvil), null);
});

test('Security - CSRF Token Verification', () => {
  const token = getCsrfToken();
  assert.ok(token);

  const validReq = {
    headers: { 'x-csrf-token': token },
    query: {}
  };
  assert.equal(verifyCsrfToken(validReq), true);

  const invalidReq = {
    headers: { 'x-csrf-token': 'wrong-token-value' },
    query: {}
  };
  assert.equal(verifyCsrfToken(invalidReq), false);

  const missingReq = {
    headers: {},
    query: {}
  };
  assert.equal(verifyCsrfToken(missingReq), false);

  // Rotate secret test
  const newToken = rotateCsrfSecret();
  assert.notEqual(token, newToken);
});
