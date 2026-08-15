'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../server/config');

test('Config - Default values are properly loaded', () => {
  assert.ok(typeof config.PORT === 'number');
  assert.ok(typeof config.HTTP_PORT === 'number');
  assert.ok(typeof config.MAX_ROOMS === 'number');
  assert.ok(typeof config.MAX_LATENCY_SAMPLES === 'number');
  assert.ok(Array.isArray(config.STUN_URLS));
  assert.ok(config.STUN_URLS.length >= 1);
});
