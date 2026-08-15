# 🏗️ WebRTC System Architecture

## Overview

The system establishes a direct peer-to-peer WebRTC video channel between a mobile camera (impolite peer) and a desktop dashboard (polite peer). A lightweight Node.js/Express + Socket.IO server acts strictly as an authenticated signaling broker.

---

## 1. Dual-Token Room Security Model (N05)

Every session is protected by cryptographic tokens issued at creation time (`/api/qr`):
- **`desktopToken`**: 128-bit secret held by the desktop dashboard.
- **`phoneToken`**: 128-bit secret embedded in the pairing QR code URL.

Both roles are authenticated on connection; third parties cannot join or hijack an active video stream.

```
 Desktop Hub                           Signaling Server                       Mobile Camera
     │                                        │                                     │
     │ 1. GET /api/qr                         │                                     │
     │ ─────────────────────────────────────> │                                     │
     │ 2. { qr, roomCode, desktopToken, token}│                                     │
     │ <───────────────────────────────────── │                                     │
     │                                        │                                     │
     │ 3. emit('join-room', {role:'desktop',  │                                     │
     │                       token: dt})      │                                     │
     │ ─────────────────────────────────────> │                                     │
     │                                        │ 4. Scan QR: /phone?room=X&token=pt  │
     │                                        │ <────────────────────────────────── │
     │                                        │ 5. emit('join-room', {role:'phone', │
     │                                        │                       token: pt})   │
     │                                        │ <────────────────────────────────── │
     │                                        │                                     │
     │ 6. peer-joined                         │ 7. peer-joined                      │
     │ <───────────────────────────────────── │ ──────────────────────────────────> │
```

---

## 2. Bidirectional Offer Buffering & Glare Resolution (N10, F1, F2)

To eliminate race conditions caused by unpredictable join orders:
- If a peer emits an SDP `offer` before the recipient has joined, the server buffers the offer in memory.
- As soon as the recipient joins and authenticates, the server immediately flushes and delivers the buffered offer.
- MDN Perfect Negotiation handles offer collisions automatically (polite desktop vs impolite phone).
- The client `IceCandidateQueue` holds candidates arriving prior to `setRemoteDescription()` execution.

```
 Mobile Phone (Impolite)              Signaling Server               Desktop Hub (Polite)
       │                                     │                                │
       │ 1. emit('offer', sdp)               │                                │
       │ ──────────────────────────────────> │ (Desktop not joined yet:       │
       │                                     │  Buffers pending offer)        │
       │                                     │                                │
       │                                     │  2. emit('join-room', desktop) │
       │                                     │ <───────────────────────────── │
       │                                     │ 3. emit('offer', bufferedSdp)  │
       │                                     │ ─────────────────────────────> │
       │                                     │                                │
       │                                     │ 4. setRemoteDescription(offer) │
       │                                     │ 5. createAnswer()              │
       │                                     │ 6. emit('answer', sdp)         │
       │                                     │ <───────────────────────────── │
       │ 7. emit('answer', sdp)              │                                │
       │ <────────────────────────────────── │                                │
       │                                     │                                │
       │ ◄══════════════════════════════════════════════════════════════════► │
       │                Direct P2P WebRTC Video Media Stream                  │
```

---

## 3. Liveness-Based Session Lifecycle & GC (N08, N09)

- **Liveness Tracking:** Every signaling message, ICE candidate, and detection frame touches `room.updatedAt = Date.now()`.
- **GC Protection:** Garbage collection evaluates inactivity rather than creation time, guaranteeing active streams are never dropped.
- **Reconnect Slot Reclaim:** Reconnecting clients present their session token to immediately reclaim disconnected slots without collision locks.
- **Desktop Persistence:** Desktop stores `{ roomCode, desktopToken, csrfToken }` in `sessionStorage`, preserving the pairing session across page refreshes.

---

## 4. Letterbox Compensation & Single-Sided Pipeline (N15, N16, N23)

- **`objectFitRect` Math:** Dynamically calculates video aspect ratio offsets for portrait/landscape video within responsive containers.
- **Single-Sided Detection:** Inference runs exclusively on the mobile GPU; bounding boxes are relayed to the desktop. If desktop detection mode is selected (`?detect=desktop`), the phone pauses its local loop to avoid redundant computation.
- **Canonical Metrics:** End-to-end latency is measured at the receiving end (`Date.now() - result.capture_ts`), eliminating cross-clock skew from server logs.
