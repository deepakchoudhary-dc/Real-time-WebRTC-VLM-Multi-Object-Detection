# 📜 Changelog

All notable changes to this project are documented in this file.

## [2.1.0] - 2026-08-15

### 🔒 Security & CyberGym Hardening
- **F-01 / F-02 / F-11 (Room Authentication):** Implemented cryptographic room codes (`crypto.randomInt`, 30-char alphabet) and 128-bit secret room tokens (`crypto.randomBytes`). Phone clients require tokens to join, preventing brute force and eavesdropping.
- **F-03 (Room Map Bounds & GC):** Added `ROOM_TTL_MS` (30 min) and periodic garbage collection sweep (every 5 min) to prevent Map memory leaks.
- **F-04 (Role Enforcement):** Enforced role authorization on all signaling and detection relay events. Only `phone` role can push `detection-result`.
- **F-05 (CSRF Protection):** Protected `POST /api/reset-metrics` with timing-safe `X-CSRF-Token` header verification.
- **F-06 / F-16 (Host Header Sanitization):** Sanitized and validated `Host` header in QR generation and HTTP-to-HTTPS redirect.
- **F-07 (SDP/ICE Schema Validation):** Added strict schema validators for SDP offers/answers and ICE candidates.
- **F-08 (Slot Isolation):** Enforced 1:1 role slots (`desktop`, `phone`); 3rd peer attempts to join an occupied slot are rejected.
- **F-09 (Socket Rate Limiting):** Implemented per-socket sliding window token bucket rate limiter (60 events/second) to prevent flood attacks.
- **F-15 (SAN TLS Certificates):** Configured `selfsigned` with Subject Alternative Names (SANs) for `localhost`, `127.0.0.1`, and all detected local LAN IPv4s, resolving iOS Safari warnings.
- **F-17 (Latency Validation):** Added `Number.isFinite()` guard in latency calculation preventing `NaN` and `null` values in metrics JSON.
- **F-19 (Privacy):** Redacted room tokens and sensitive credentials from structured logs. Updated `.dockerignore` to exclude `.env` and tests.

### ⚡ WebRTC Signaling Overhaul
- **F1 / F2 (Perfect Negotiation & Offer Buffer):** Implemented MDN Perfect Negotiation (`polite` desktop vs `impolite` phone) and server-side offer buffering so pairing succeeds regardless of whether desktop or phone connects first.
- **F2 (ICE Candidate Queue):** Implemented `IceCandidateQueue` to buffer candidates arriving before `setRemoteDescription()`.
- **F4 (Point-to-Peer Relay):** Replaced room-wide broadcasts with direct point-to-peer socket messaging.
- **F5 / L49 (Reconnection):** Added idempotent rejoin flow on socket reconnect; desktop session state preserved across reloads.
- **F7 / F20 (TURN / ICE Config):** Added `/api/ice-config` endpoint with Coturn REST API HMAC time-limited credential generation.
- **F10 / L35 (Constraint-Based Quality):** Fixed HD toggle to use `videoTrack.applyConstraints()`, eliminating the broken double-flip restart.
- **F12 (Mirror-Aware Overlays):** Fixed front-camera flipping using CSS transforms while keeping bounding box coordinate translations accurate.
- **L25 / F20 (Single-Sided Detection):** Eliminated duplicate inference loops and double-counting of processed frame metrics.

### 🧹 Dead Code & Architecture Modularization
- Removed orphan ONNX subsystem (`models/`, `scripts/download_models.sh`, D12, D23).
- Renamed `yolo-detector.js` to `detector.js` (F19).
- Split monolithic `https_server.js` into modular components: `config.js`, `logger.js`, `tls.js`, `security.js`, `rate-limiter.js`, `metrics.js`, `room-store.js`, `signaling.js`, `routes.js`, `http-redirect.js`, `app.js`, `index.js`.
- Added automated unit and integration test suite (`test/run-all.js`).
- Created hardened Dockerfile (`node:22-alpine`, non-root user `node`, `dumb-init`) and resource-limited `docker-compose.yml`.
- Added comprehensive documentation suite (`README.md`, `DEVELOPMENT.md`, `SECURITY.md`, `ARCHITECTURE.md`, `API.md`, `CHANGELOG.md`).
