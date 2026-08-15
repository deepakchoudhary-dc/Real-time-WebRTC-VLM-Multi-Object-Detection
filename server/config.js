'use strict';

const fs = require('fs');
const path = require('path');

// Safe pure-Node .env loader (zero external dependency required)
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
} catch {
  // Ignore .env loading errors
}

const config = {
  // Network & Ports
  PORT: parseInt(process.env.PORT, 10) || 3443,
  HTTP_PORT: parseInt(process.env.HTTP_PORT, 10) || 3000,
  PUBLIC_URL: process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : null,
  HOST_WHITELIST: process.env.HOST_WHITELIST
    ? process.env.HOST_WHITELIST.split(',').map((h) => h.trim().toLowerCase())
    : null,

  // Node Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PROD: process.env.NODE_ENV === 'production',

  // Room & Connection Limits
  MAX_ROOMS: parseInt(process.env.MAX_ROOMS, 10) || 100,
  ROOM_TTL_MS: parseInt(process.env.ROOM_TTL_MS, 10) || 30 * 60 * 1000, // 30 mins
  ROOM_GC_INTERVAL_MS: parseInt(process.env.ROOM_GC_INTERVAL_MS, 10) || 5 * 60 * 1000, // 5 mins
  MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS, 10) || 100,
  MAX_LATENCY_SAMPLES: parseInt(process.env.MAX_LATENCY_SAMPLES, 10) || 1000,

  // Rate Limiting (HTTP)
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 120,

  // Rate Limiting (Socket events per connection)
  SOCKET_RATE_LIMIT_WINDOW_MS: parseInt(process.env.SOCKET_RATE_LIMIT_WINDOW_MS, 10) || 1000,
  SOCKET_RATE_LIMIT_MAX_EVENTS: parseInt(process.env.SOCKET_RATE_LIMIT_MAX_EVENTS, 10) || 60,

  // Buffer limits
  MAX_PAYLOAD_BYTES: 1024 * 1024, // 1 MB max frame payload

  // STUN / TURN Configuration
  TURN_URL: process.env.TURN_URL || null,
  TURN_USERNAME: process.env.TURN_USERNAME || null,
  TURN_CREDENTIAL: process.env.TURN_CREDENTIAL || null,
  TURN_SECRET: process.env.TURN_SECRET || null, // For time-limited HMAC credentials
  STUN_URLS: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302'
  ]
};

module.exports = config;
