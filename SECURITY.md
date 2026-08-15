# 🔒 Security Threat Model & Defense Mechanisms

This document outlines the security architecture, threat model, and defense implementations of the WebRTC vision platform.

---

## 1. Threat Model & Mitigation Matrix

| Threat / Attack Vector | Risk Level | Defensive Mitigation | Implementation Reference |
| :--- | :---: | :--- | :--- |
| **Stream Interception / Hijacking** | **CRITICAL** | Separate 128-bit `desktopToken` and `phoneToken` generated per session via `crypto.randomBytes`. Tokens are verified using `crypto.timingSafeEqual`. Both peers must present valid tokens to join. | [room-store.js](file:///e:/ADBrand2/server/room-store.js#L110) |
| **Room Code Brute-Forcing** | **HIGH** | CSPRNG 6-character room codes (`crypto.randomInt` over 30-char unambiguous alphabet). IP-level rate limiting (120 req/min) on `/api/*`. | [room-store.js](file:///e:/ADBrand2/server/room-store.js#L26), [rate-limiter.js](file:///e:/ADBrand2/server/rate-limiter.js#L8) |
| **Signaling Eavesdropping** | **HIGH** | Signaling is relayed strictly point-to-peer (`io.to(peerSocketId)`). No room broadcast channels exist. | [signaling.js](file:///e:/ADBrand2/server/signaling.js#L149) |
| **Video Data Leakage** | **CRITICAL** | Raw video travels directly peer-to-peer over DTLS-SRTP encrypted WebRTC. The server never handles or stores raw media frames. Audio is disabled. | [phone.js](file:///e:/ADBrand2/frontend/js/phone.js#L182) |
| **Stored XSS via Detection Feed** | **MEDIUM** | Detection labels are validated against an allowlist and rendered exclusively via safe `textContent` DOM nodes (no `innerHTML` with remote data). | [signaling.js](file:///e:/ADBrand2/server/signaling.js#L10), [app.js](file:///e:/ADBrand2/frontend/js/app.js#L420) |
| **CSRF Tampering** | **MEDIUM** | Administrative actions (`POST /api/reset-metrics`) require a single-use per-session CSRF token passed via `X-CSRF-Token` headers. | [security.js](file:///e:/ADBrand2/server/security.js#L80) |
| **Host Header Injection** | **MEDIUM** | Host headers in QR generation and HTTP redirection are validated against `net.isIP` private ranges and local hostnames before URL construction. | [security.js](file:///e:/ADBrand2/server/security.js#L40) |
| **Socket Flood / DoS** | **HIGH** | Per-socket sliding window token bucket rate limiter (60 events/sec) with automatic `error-message` event notifications. | [rate-limiter.js](file:///e:/ADBrand2/server/rate-limiter.js#L46), [signaling.js](file:///e:/ADBrand2/server/signaling.js#L112) |
| **Resource Exhaustion** | **MEDIUM** | Bounded in-memory structures: `MAX_ROOMS` cap, `ROOM_TTL_MS` (30 min) liveness sweep, `MAX_CONNECTIONS` connection cap, ring buffer for latency samples. | [room-store.js](file:///e:/ADBrand2/server/room-store.js#L42), [metrics.js](file:///e:/ADBrand2/server/metrics.js#L10) |
| **Log Leakage** | **LOW** | Structured logging redacts all tokens, secrets, credentials, and masks room codes in log outputs. | [logger.js](file:///e:/ADBrand2/server/logger.js#L18) |

---

## 2. Content Security Policy (CSP)

The server enforces strict HTTP security headers:
- `Content-Security-Policy`: `default-src 'self' ... object-src 'none'; frame-ancestors 'none';`
- `X-Content-Type-Options`: `nosniff`
- `X-Frame-Options`: `DENY`
- `X-XSS-Protection`: `1; mode=block`
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains` (when served over TLS)
