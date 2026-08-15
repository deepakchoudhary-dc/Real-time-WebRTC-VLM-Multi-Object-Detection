'use strict';

const config = require('./config');

// In-memory HTTP rate limiter map: ip -> { windowStart, count }
const httpRateLimitMap = new Map();

function httpRateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let record = httpRateLimitMap.get(ip);

  if (!record || now - record.windowStart > config.RATE_LIMIT_WINDOW_MS) {
    record = { windowStart: now, count: 0 };
    httpRateLimitMap.set(ip, record);
  }

  record.count++;

  if (record.count > config.RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfterSeconds: Math.ceil((record.windowStart + config.RATE_LIMIT_WINDOW_MS - now) / 1000)
    });
  }

  next();
}

// Periodic cleanup of stale HTTP rate limit records
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of httpRateLimitMap) {
    if (now - record.windowStart > config.RATE_LIMIT_WINDOW_MS * 2) {
      httpRateLimitMap.delete(ip);
    }
  }
}, 60_000);

if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Per-Socket Token Bucket / Sliding Window Rate Limiter
 */
class SocketRateLimiter {
  constructor(windowMs = config.SOCKET_RATE_LIMIT_WINDOW_MS, maxEvents = config.SOCKET_RATE_LIMIT_MAX_EVENTS) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
    this.windowStart = Date.now();
    this.eventCount = 0;
  }

  /**
   * Check if event is permitted under rate limit
   * @returns {boolean} true if permitted, false if rate limited
   */
  allowEvent() {
    const now = Date.now();
    if (now - this.windowStart > this.windowMs) {
      this.windowStart = now;
      this.eventCount = 0;
    }

    if (this.eventCount >= this.maxEvents) {
      return false;
    }

    this.eventCount++;
    return true;
  }
}

module.exports = {
  httpRateLimiter,
  SocketRateLimiter
};
