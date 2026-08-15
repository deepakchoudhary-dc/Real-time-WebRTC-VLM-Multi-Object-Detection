'use strict';

const net = require('net');
const crypto = require('crypto');
const config = require('./config');

/**
 * Constant-time comparison for tokens and hashes (R10, R11)
 */
function safeCompareTokens(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check if an IP address is in a private/local range (R14)
 */
function isPrivateIP(ip) {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return false;
    }
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // ::1 loopback or fe80::/10 link-local or fc00::/7 unique local
    if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
  }

  return false;
}

/**
 * Validate incoming request origin (used by CORS and Socket.IO handshake)
 */
function isOriginAllowed(origin) {
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || isPrivateIP(hostname)) {
      return true;
    }

    if (config.PUBLIC_URL) {
      const publicParsed = new URL(config.PUBLIC_URL);
      if (hostname === publicParsed.hostname.toLowerCase()) {
        return true;
      }
    }

    if (config.HOST_WHITELIST && config.HOST_WHITELIST.includes(hostname)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Validate and sanitize host header (IPv4 and IPv6 safe, R14)
 */
function getValidHost(req) {
  const rawHost = req.get('host') || req.headers.host || '';
  if (!rawHost || rawHost.length > 100) return null;

  let hostname = rawHost;
  // Handle IPv6 bracket format e.g. [::1]:3443
  if (rawHost.startsWith('[')) {
    const closeBracket = rawHost.indexOf(']');
    if (closeBracket !== -1) {
      hostname = rawHost.slice(1, closeBracket);
    }
  } else if (rawHost.includes(':')) {
    hostname = rawHost.split(':')[0];
  }

  hostname = hostname.toLowerCase();

  if (hostname === 'localhost' || isPrivateIP(hostname)) {
    return rawHost;
  }

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
 * Per-session CSRF token manager with TTL & Single-use Rotation (N12)
 */
const csrfTokenStore = new Map(); // token -> timestamp
const CSRF_TTL_MS = 60 * 60 * 1000; // 1 hour

function issueCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokenStore.set(token, Date.now());
  return token;
}

function verifyAndConsumeCsrfToken(req) {
  const token = req.headers['x-csrf-token'];
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return false;
  }

  const issuedAt = csrfTokenStore.get(token);
  if (!issuedAt) return false;

  const now = Date.now();
  if (now - issuedAt > CSRF_TTL_MS) {
    csrfTokenStore.delete(token);
    return false;
  }

  // Consume token on use (single-use rotation)
  csrfTokenStore.delete(token);
  return true;
}

// Periodic cleanup of expired CSRF tokens
const csrfCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, ts] of csrfTokenStore) {
    if (now - ts > CSRF_TTL_MS) {
      csrfTokenStore.delete(token);
    }
  }
}, 300_000);

if (csrfCleanupTimer.unref) {
  csrfCleanupTimer.unref();
}

module.exports = {
  safeCompareTokens,
  isOriginAllowed,
  getValidHost,
  securityHeaders,
  issueCsrfToken,
  verifyAndConsumeCsrfToken
};
