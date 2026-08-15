# 📜 Changelog

All notable changes to this project are documented in this file.

## [2.1.1] - 2026-08-15

### 🔒 Security, Authentication & Reliability
- **G09 / R01 (COCO Allowlist & XSS Sanitization):** Enforced strict COCO-80 label allowlist in detection validation and migrated detection feed rendering to safe `textContent` DOM nodes.
- **G02 / G12 (Refreshed CSRF Token Rotation):** `/api/reset-metrics` returns refreshed single-use CSRF tokens, allowing consecutive resets and benchmark runs without 403 errors.
- **G06 / R14 (IPv6 Bracket-Safe Validation):** Normalized IPv6 hostnames in origin checks and HTTP redirection (`isOriginAllowed`, `getValidHost`, `http-redirect.js`).
- **G07 / G08 (Unified GC Sweeps & Grace Reclaim):** Connected overflow sweeps to the shared `room-closed` notification callback and enabled instant slot reclaim for disconnected sockets.
- **R10 / R11 (Constant-Time Token Verification):** Verified session tokens with `crypto.timingSafeEqual` in `RoomStore`.
- **G10 / G11 (Configuration & ICE Knobs):** Restored environment variable controls for rate limiters, payload bounds, and validated STUN/TURN URL schemes.
- **G01 / R13 (Truthful Metrics):** Eliminated dead `total_frames` counter; `processed_frames` serves as single truthful counter.

### ⚡ WebRTC & Frontend
- **R02 (Live E2E Latency Reporting):** Desktop reports measured live E2E latency to the server via `metrics-report`, powering live `/api/metrics` percentiles.
- **G04 / G05 (Bfcache Full Re-Init & Listener Cleanup):** Cleaned up socket listeners in `PerfectNegotiator.dispose()` and implemented full WebRTC re-initialization on `pageshow`.
- **G03 (Session-Preserving Mode Toggle):** Switching between Mobile GPU and Desktop Hub detection preserves the active session and room code.
- **G14 (Safe Camera Switch Fallback):** Camera switching keeps active streams intact until new constraints succeed.
- **N20 (Mobile Model Retry UX):** Added interactive retry button on mobile camera detector load failures.
- **G16 (Cancellable Benchmark):** Benchmark executions abort cleanly on page teardown.
