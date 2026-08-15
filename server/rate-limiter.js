'use strict';

const config = require('./config');

/**
 * In-memory sliding window rate limiter for HTTP routes
 */
function createHttpRateLimiter(windowMs = config.RATE_LIMIT_WINDOW_MS, maxRequests = config.RATE_LIMIT_MAX_REQUESTS) {
  const requests = new Map(); // ip -> [timestamps]

  // Periodic cleanup of expired IP records
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requests.entries()) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, valid);
      }
    }
  }, windowMs);

  if (cleanupTimer.unref) cleanupTimer.unref();

  return function rateLimiterMiddleware(req, res, next) {
    const rawIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();

    const timestamps = requests.get(rawIp) || [];
    const recent = timestamps.filter((t) => now - t < windowMs);

    if (recent.length >= maxRequests) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({
        error: 'Too many requests. Please try again later.'
      });
    }

    recent.push(now);
    requests.set(rawIp, recent);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - recent.length));

    next();
  };
}

const httpRateLimiter = createHttpRateLimiter(config.RATE_LIMIT_WINDOW_MS, config.RATE_LIMIT_MAX_REQUESTS);
const qrRateLimiter = createHttpRateLimiter(config.RATE_LIMIT_WINDOW_MS, config.QR_RATE_LIMIT_MAX); // Dedicated QR Room Creation Limiter (H13)

/**
 * Per-Socket Sliding Window Rate Limiter
 */
class SocketRateLimiter {
  constructor(windowMs = config.SOCKET_RATE_LIMIT_WINDOW_MS, maxEvents = config.SOCKET_RATE_LIMIT_MAX_EVENTS) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
    this.events = [];
  }

  allowEvent() {
    const now = Date.now();
    this.events = this.events.filter((t) => now - t < this.windowMs);

    if (this.events.length >= this.maxEvents) {
      return false;
    }

    this.events.push(now);
    return true;
  }
}

module.exports = {
  createHttpRateLimiter,
  httpRateLimiter,
  qrRateLimiter,
  SocketRateLimiter
};
