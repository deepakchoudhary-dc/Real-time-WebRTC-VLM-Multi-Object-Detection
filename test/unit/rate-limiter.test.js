'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SocketRateLimiter } = require('../../server/rate-limiter');

test('SocketRateLimiter - Enforces event cap within window', () => {
  const limiter = new SocketRateLimiter(50, 3); // 50ms window, 3 events max

  assert.equal(limiter.allowEvent(), true); // 1
  assert.equal(limiter.allowEvent(), true); // 2
  assert.equal(limiter.allowEvent(), true); // 3
  assert.equal(limiter.allowEvent(), false); // 4 (blocked)
  assert.equal(limiter.allowEvent(), false); // 5 (blocked)

  return new Promise((resolve) => {
    setTimeout(() => {
      // Window should have reset
      assert.equal(limiter.allowEvent(), true);
      resolve();
    }, 60);
  });
});
