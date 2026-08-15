# 🛠️ Developer Setup & Architecture Guide

## 1. Project Structure

```
├── server/
│   ├── app.js             # Express middleware, security headers & error handling
│   ├── config.js          # Centralized configuration & environment loader
│   ├── http-redirect.js   # HTTP -> HTTPS automatic port redirector
│   ├── index.js           # Server lifecycle, HTTPS/Socket.IO bootstrap, GC sweeps
│   ├── logger.js          # Structured privacy logger (redacts tokens & codes)
│   ├── metrics.js         # In-memory bounded ring buffer & percentile calculator
│   ├── rate-limiter.js    # Sliding window rate limiter for HTTP and Socket.IO
│   ├── room-store.js      # Room lifecycle, dual-token auth, offer buffering
│   ├── routes.js          # REST endpoints (/api/qr, /api/metrics, /health, etc.)
│   ├── security.js        # Timing-safe token auth, IPv4/IPv6 sanitization, CSRF
│   ├── signaling.js       # Socket.IO WebRTC relay, COCO sanitation, mode sync
│   └── tls.js             # Dynamic in-memory multi-SAN TLS certificate generator
├── frontend/
│   ├── index.html         # Desktop Hub interface with live AI overlay
│   ├── phone.html         # Mobile Camera interface with controls & HUD
│   ├── css/
│   │   ├── style.css      # Desktop styles & responsive layout
│   │   └── phone.css      # Mobile styles & touch controls
│   └── js/
│       ├── app.js         # Desktop Hub client application
│       ├── detector.js    # Client-side TensorFlow.js COCO-SSD detector
│       ├── phone.js       # Mobile camera client application
│       └── core/
│           └── common.js  # MDN Perfect Negotiation, shared box rendering, helpers
└── test/
    ├── run-all.js         # Custom zero-dependency test runner
    ├── unit/              # Isolated unit test suites
    └── integration/       # Route & signaling integration test suites
```

---

## 2. Local Development

```bash
# Start server in development mode
npm start
```

### Running Tests
```bash
npm test
```

---

## 3. WebSockets & Signaling Protocol

WebRTC signaling is handled over Socket.IO using direct point-to-peer relaying:
- **`join-room`**: Requires valid `desktopToken` or `phoneToken`. Supports authoritative reconnect and slot reclaim.
- **`detect-mode`**: Synchronizes inference execution mode between desktop and phone in real time.
- **`metrics-report`**: Desktop reports measured E2E latency to the server metrics store.
