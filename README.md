# 📱🎯 Real-Time WebRTC Multi-Object Detection v2.1.1

A production-grade, privacy-first computer vision platform that turns any mobile phone into a wireless real-time AI camera stream over **P2P WebRTC** with **TensorFlow.js COCO-SSD** running client-side GPU-accelerated multi-object detection.

---

## ✨ Features & Architecture

```
[ Mobile Phone (Camera Node) ] 
       │  ▲
WebRTC │  │  Socket.IO Thin Signaling Relay
Video  │  │  (Dual-token authenticated, role-isolated, offer-buffered)
Media  │  │
       ▼  │
[ Desktop Hub / Browser Client ] ◄── [ Express HTTPS Server ]
       │                               (Dynamic SAN TLS, CSP)
   WebGL GPU / TF.js COCO-SSD
  (Real-Time Inference Overlay)
```

- 📱 **Wireless Mobile Camera Stream:** Streams low-latency camera video from phone to desktop over direct P2P WebRTC.
- 🧠 **Genuine Client-Side AI Detection:** Powered by TensorFlow.js COCO-SSD detecting 80 COCO object classes (`person`, `car`, `phone`, `bottle`, `laptop`, etc.) using WebGL GPU hardware acceleration.
- 🔒 **Zero-Trust Security & Privacy:**
  - **Dual-Token Authentication:** Cryptographically generated room codes (`crypto.randomInt`) and distinct 128-bit secret tokens for desktop and mobile (`crypto.randomBytes`) preventing eavesdropping and stream hijacking.
  - **Authoritative Reconnect & Constant-Time Verification:** Session tokens are compared using `crypto.timingSafeEqual`, allowing authoritative reconnect without spurious peer-left disruptions.
  - **Point-to-Peer Routing:** Signaling messages (SDP offers/answers, ICE candidates) are routed strictly to designated peer socket IDs, never broadcast to rooms.
  - **Dynamic In-Memory SAN Certificates:** Generated on boot with Subject Alternative Names (SANs) for all local LAN IPs, eliminating browser warnings on mobile and iOS Safari.
  - **Hardened HTTP Security Headers:** CSP, HSTS, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.
- ⚡ **MDN Perfect Negotiation & Bidirectional Offer Buffering:**
  - Seamless connection flow regardless of whether Desktop or Phone joins first.
  - Automatic glare recovery, ICE candidate queueing, and single-owner ICE restart.
- 📊 **Canonical Live Metrics & Benchmark Suite:**
  - Live E2E latency reported directly from desktop clients to the metrics store.
  - Single truthful `processed_frames` counter.
  - Built-in 30-second automated benchmark tool with JSON export.
- 🐳 **Hardened Container Deployment:** Multi-stage `node:22-alpine` image with non-root execution (`USER node`), dumb-init signal handling, resource limits, and health checks.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 20+ ([Download](https://nodejs.org/))
- **Modern Web Browser** (Chrome, Firefox, Safari, Edge) with WebGL enabled
- **Mobile Phone** connected to the same Wi-Fi / LAN

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/deepakchoudhary-dc/webrtc-object-detection.git
cd webrtc-object-detection

# Start the secure HTTPS server
npm start
```

### 2. Connect & Detect
1. **Desktop:** Open `https://localhost:3443` in your desktop browser.
   - *Note:* Accept the self-signed certificate warning once (standard for local development HTTPS).
2. **Mobile:** Scan the QR code displayed on the desktop screen or open the provided link `https://<YOUR-LAN-IP>:3443/phone?room=<CODE>&token=<TOKEN>`.
3. **Detection:** Tap **"Start Camera"** on your phone. Real-time AI bounding boxes will track objects with live latency and FPS metrics.

---

## 🧪 Testing & Verification

Run the automated test suite covering unit tests and integration tests:

```bash
npm test
```

Test suites include:
- `test/unit/room-store.test.js`: Dual-token validation, authoritative slot reclaim, 3rd peer rejection, liveness GC.
- `test/unit/metrics.test.js`: Bounded ring buffer, `NaN`/infinite number rejection, percentile math.
- `test/unit/rate-limiter.test.js`: Socket event token bucket rate limiting.
- `test/unit/security.test.js`: Constant-time token verification, host header sanitization, per-session CSRF tokens.
- `test/integration/routes.test.js`: Health checks, QR generation, ICE configuration, CSRF reset, malformed JSON 400.
- `test/integration/signaling.test.js`: Socket.IO WebRTC pairing, authoritative reconnect, bidirectional offer buffering, role security, live metrics.

---

## 🐳 Docker Deployment

Run with Docker Compose in a single command:

```bash
docker-compose up --build
```

Access at `https://localhost:3443` (HTTP on port `3000` automatically redirects to HTTPS `3443`).

---

## 📄 Documentation Links

- 📖 [DEPLOYMENT.md](DEPLOYMENT.md) — Production guide for Docker, reverse proxies, and Coturn TURN (RFC 7635).
- 📖 [DEVELOPMENT.md](DEVELOPMENT.md) — Developer setup, module split, and local testing.
- 🔒 [SECURITY.md](SECURITY.md) — Threat model, security audit findings, and hardening details.
- 🏗️ [ARCHITECTURE.md](ARCHITECTURE.md) — WebRTC signaling state machine and data flow.
- 📡 [API.md](API.md) — REST endpoints and Socket.IO protocol specification.
- 📜 [CHANGELOG.md](CHANGELOG.md) — Release notes and audit remediations.
