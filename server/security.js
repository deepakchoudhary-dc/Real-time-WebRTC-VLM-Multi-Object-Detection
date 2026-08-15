'use strict';

const config = require('./config');
const crypto = require('crypto');

// Standard LAN IP pattern
const LAN_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

/**
 * Validate incoming request origin (used by CORS and Socket.IO handshake)
 */
function isOriginAllowed(origin) {
  // Allow requests without Origin header (e.g. same-origin GET/POST, mobile webview, curl)
  if (!origin) return true;

  // Check LAN regex
  if (LAN_ORIGIN_REGEX.test(origin)) return true;

  // Check explicit public URL
  if (config.PUBLIC_URL && origin.toLowerCase() === config.PUBLIC_URL.toLowerCase()) {
    return true;
  }

  // Check host whitelist
  if (config.HOST_WHITELIST) {
    try {
      const parsed = new URL(origin);
      if (config.HOST_WHITELIST.includes(parsed.hostname.toLowerCase())) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Validate and sanitize host header (prevent host-header injection / cache poisoning)
 */
function getValidHost(req) {
  const rawHost = req.get('host') || req.headers.host || '';
  if (!rawHost || rawHost.length > 100) return null;

  // Strip port to check hostname
  const hostname = rawHost.split(':')[0].toLowerCase();

  // Allow localhost & LAN IP ranges
  const isLanHost = /^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(hostname);
  if (isLanHost) return rawHost;

  if (config.HOST_WHITELIST && config.HOST_WHITELIST.includes(hostname)) {
    return rawHost;
  }

  return null;
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' wss: ws: blob: data: https://storage.googleapis.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );

  next();
}

/**
 * In-memory CSRF secret for administrative actions (e.g. /api/reset-metrics)
 */
let csrfSecret = crypto.randomBytes(32).toString('hex');

function getCsrfToken() {
  return csrfSecret;
}

function rotateCsrfSecret() {
  csrfSecret = crypto.randomBytes(32).toString('hex');
  return csrfSecret;
}

function verifyCsrfToken(req) {
  const token = req.headers['x-csrf-token'] || req.query.csrfToken;
  if (!token || typeof token !== 'string') return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(csrfSecret));
  } catch {
    return false;
  }
}

module.exports = {
  isOriginAllowed,
  getValidHost,
  securityHeaders,
  getCsrfToken,
  rotateCsrfSecret,
  verifyCsrfToken
};
