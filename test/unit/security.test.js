'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeCompareTokens, isOriginAllowed, getValidHost, issueCsrfToken, verifyAndConsumeCsrfToken } = require('../../server/security');

test('Security - Constant-Time Token Comparison (R10, R11)', () => {
  const token = 'abcdef0123456789abcdef0123456789';
  assert.equal(safeCompareTokens(token, token), true);
  assert.equal(safeCompareTokens(token, 'abcdef0123456789abcdef0123456780'), false);
  assert.equal(safeCompareTokens(token, 'short'), false);
  assert.equal(safeCompareTokens(null, token), false);
  assert.equal(safeCompareTokens(token, undefined), false);
});

test('Security - Origin and IP validation (R14)', () => {
  // Local origins
  assert.equal(isOriginAllowed('http://localhost:3000'), true);
  assert.equal(isOriginAllowed('https://localhost:3443'), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:3000'), true);

  // LAN IP ranges (IPv4)
  assert.equal(isOriginAllowed('https://192.168.1.50:3443'), true);
  assert.equal(isOriginAllowed('https://10.0.0.2:3443'), true);
  assert.equal(isOriginAllowed('https://172.20.10.3:3443'), true);

  // Invalid / Unclamped IP strings (R14)
  assert.equal(isOriginAllowed('https://192.168.999.999:3443'), false);

  // Disallowed external origin
  assert.equal(isOriginAllowed('https://evil-attacker.com'), false);
  assert.equal(isOriginAllowed('https://malicious.org:3443'), false);
});

test('Security - Host header validation (IPv4 and IPv6, R14)', () => {
  const reqLocal = { get: () => 'localhost:3443', headers: {} };
  assert.equal(getValidHost(reqLocal), 'localhost:3443');

  const reqLan = { get: () => '192.168.1.100:3443', headers: {} };
  assert.equal(getValidHost(reqLan), '192.168.1.100:3443');

  const reqIpv6 = { get: () => '[::1]:3443', headers: {} };
  assert.equal(getValidHost(reqIpv6), '[::1]:3443');

  const reqEvil = { get: () => 'evil.attacker.com', headers: {} };
  assert.equal(getValidHost(reqEvil), null);
});

test('Security - Per-Session CSRF Token Issuance and Consumption (N12)', () => {
  const token = issueCsrfToken();
  assert.ok(token);
  assert.equal(token.length, 64);

  // Valid token consumption
  const validReq = {
    headers: { 'x-csrf-token': token }
  };
  assert.equal(verifyAndConsumeCsrfToken(validReq), true);

  // Re-consuming same token fails (single-use rotation)
  assert.equal(verifyAndConsumeCsrfToken(validReq), false);

  // Invalid token fails
  const invalidReq = {
    headers: { 'x-csrf-token': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }
  };
  assert.equal(verifyAndConsumeCsrfToken(invalidReq), false);
});
