'use strict';

const fs = require('fs');
const path = require('path');

// Safe, zero-dependency environment loader (F-18)
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx === -1) continue;

      const key = trimmed.slice(0, equalsIdx).trim();
      let value = trimmed.slice(equalsIdx + 1).trim();

      // Unquote value if wrapped
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore read errors
  }
}

loadEnv();

const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3443,
  HTTP_PORT: parseInt(process.env.HTTP_PORT, 10) || 3000,
  PUBLIC_URL: process.env.PUBLIC_URL || null,
  HOST_WHITELIST: process.env.HOST_WHITELIST ? process.env.HOST_WHITELIST.split(',').map((h) => h.trim().toLowerCase()) : null,

  // WebRTC ICE / STUN / TURN
  STUN_URLS: process.env.STUN_URLS
    ? process.env.STUN_URLS.split(',').map((u) => u.trim())
    : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  TURN_URL: process.env.TURN_URL || null,
  TURN_USERNAME: process.env.TURN_USERNAME || null,
  TURN_CREDENTIAL: process.env.TURN_CREDENTIAL || null,
  TURN_SECRET: process.env.TURN_SECRET || null, // Coturn REST API shared secret

  // Rate Limiting & Caps
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 120,
  SOCKET_RATE_LIMIT_WINDOW_MS: 1000,
  SOCKET_RATE_LIMIT_MAX_EVENTS: 60, // max 60 socket events/sec
  MAX_ROOMS: parseInt(process.env.MAX_ROOMS, 10) || 100,
  ROOM_TTL_MS: parseInt(process.env.ROOM_TTL_MS, 10) || 30 * 60 * 1000, // 30 minutes
  ROOM_ABANDONMENT_TTL_MS: parseInt(process.env.ROOM_ABANDONMENT_TTL_MS, 10) || 5 * 60 * 1000, // 5 minutes (N43)
  ROOM_GC_INTERVAL_MS: 60 * 1000,
  MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS, 10) || 100,
  MAX_LATENCY_SAMPLES: 1000,
  MAX_PAYLOAD_BYTES: 256 * 1024 // 256KB
};

module.exports = config;
