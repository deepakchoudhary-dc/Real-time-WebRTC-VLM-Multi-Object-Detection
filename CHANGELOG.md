# 📜 Changelog

All notable changes to this project are documented in this file.

## [2.1.1] - 2026-08-15 (Part 2 Audit Remediation)

### 🔒 Security & Authentication Completion
- **N05 (Dual-Token Authentication):** Implemented separate 128-bit `desktopToken` and `phoneToken` generation on `/api/qr`. Desktop and mobile clients must present matching tokens to join room slots, completely preventing unauthenticated desktop stream theft.
- **N06 (Bounded Room Minting):** Removed auto-create path in `joinRoom`; all room allocation is strictly gated by `createRoom()` and capped at `MAX_ROOMS`.
- **N07 (Connection Cap):** Enforced `MAX_CONNECTIONS` socket admission guard in `io.use` middleware.
- **N08 (Liveness GC):** Shifted RoomStore garbage collection from creation time to inactivity window (`updatedAt`), preventing active long-running streams from being dropped mid-session.
- **N09 (Slot Reclaim on Reconnect):** Enabled instant slot reclaim for reconnecting clients presenting valid session tokens.
- **N10 (Bidirectional Offer Buffering):** Implemented offer buffering for both phone-first and desktop-first join orders with client-side retry backoff.
- **N11 (Session Persistence):** Desktop session state is saved in `sessionStorage` to restore rooms on browser reload without generating orphan rooms.
- **N12 (Per-Session CSRF):** Replaced static CSRF secret with single-use per-session rotating tokens with 1-hour TTL, accepted exclusively via `X-CSRF-Token` headers.
- **N31 (Rate Limit Error Notifications):** Added `error-message` event emission on socket throttling and `X-RateLimit-*` / `Retry-After` headers to HTTP rate limiters.
- **N33 (Malformed JSON Handling):** Express error handler cleanly returns HTTP 400 for malformed JSON bodies.

### ⚡ Build, Pipeline & Frontend
- **N01 & N02 (Dependency Alignment):** Corrected `selfsigned` version to `^3.0.1` and aligned `package.json` manifest.
- **N03 (Multi-Stage Docker):** Implemented true multi-stage `node:22-alpine` build with non-root user `node`, `dumb-init`, and health checks.
- **N04 (CI Suite):** Added dependency installation, cache, and test suite execution to GitHub Actions CI workflow.
- **N15 & N16 (Canonical Metrics):** Eliminated cross-clock server latency calculations; E2E latency is computed cleanly on the client (`Date.now() - capture_ts`), and frame counts increment only on successful peer delivery.
- **N21 (Single-Sided Detection Gating):** Phone detection loop pauses when `detect=desktop` mode is active to prevent redundant double inference.
- **N23 (Phone Orientation):** Added `ResizeObserver` on mobile camera container for responsive canvas orientation adjustments.
- **N24 & N25 (Lifecycle & bfcache):** Fixed interval leak in phone HUD metrics, added `detector.dispose()`, and implemented visibility / bfcache restore handling.
- **N30 (Deployment Guide):** Added comprehensive `DEPLOYMENT.md` covering Docker Compose, systemd, reverse proxies, and Coturn TURN setup.
- **N34 (Test Timeout Protection):** Added 10-second subprocess timeout to `test/run-all.js`.
