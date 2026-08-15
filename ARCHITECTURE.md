# 🏗️ WebRTC System Architecture

## Overview

The system establishes a direct peer-to-peer WebRTC video channel between a mobile camera (impolite peer) and a desktop dashboard (polite peer). A lightweight Node.js/Express + Socket.IO server acts strictly as an authenticated signaling broker.

---

## 1. WebRTC Signaling State Machine

We implement the canonical **MDN Perfect Negotiation** pattern combined with **Server-Side Offer Buffering** to guarantee deterministic connection setup regardless of join order.

```
 Mobile Phone (Impolite)              Signaling Server               Desktop Hub (Polite)
       │                                     │                                │
       │ 1. GET /phone?room=XYZ&token=ABC    │                                │
       │ ──────────────────────────────────> │                                │
       │ 2. emit('join-room', {role, token}) │                                │
       │ ──────────────────────────────────> │ (Validates token, assigns slot)│
       │                                     │                                │
       │ 3. getUserMedia() -> addTrack()     │                                │
       │ 4. emit('offer', sdp)               │                                │
       │ ──────────────────────────────────> │ (Desktop not joined yet:       │
       │                                     │  Buffers pending offer)        │
       │                                     │                                │
       │                                     │  5. GET / -> /api/qr           │
       │                                     │ <───────────────────────────── │
       │                                     │  6. emit('join-room', 'desktop')│
       │                                     │ <───────────────────────────── │
       │                                     │ 7. emit('offer', bufferedSdp)  │
       │                                     │ ─────────────────────────────> │
       │                                     │                                │
       │                                     │ 8. setRemoteDescription(offer) │
       │                                     │ 9. createAnswer()              │
       │                                     │ 10. emit('answer', sdp)        │
       │                                     │ <───────────────────────────── │
       │ 11. emit('answer', sdp)             │                                │
       │ <────────────────────────────────── │                                │
       │ 12. setRemoteDescription(answer)    │                                │
       │                                     │                                │
       │ ◄══════════════════════════════════════════════════════════════════► │
       │                Direct P2P WebRTC Video Media Stream                  │
```

---

## 2. ICE Candidate Buffering (`IceCandidateQueue`)

When ICE candidates arrive before `setRemoteDescription()` completes, they are buffered in the client-side `IceCandidateQueue`. As soon as the remote session description is set, the queue flushes all pending candidates via `pc.addIceCandidate()`.

---

## 3. Letterbox & Coordinate Mapping (`objectFitRect`)

Mobile cameras produce portrait aspect ratios (e.g. 9:16 or 3:4), whereas desktop containers are typically 16:9. The `objectFitRect` function calculates the exact render boundaries:

$$\text{Render Rect} = \text{compute}(\text{containerWidth}, \text{containerHeight}, \text{videoWidth}, \text{videoHeight}, \text{mode})$$

Bounding boxes are translated from normalized space $[0..1]$ to:
$$X = \text{rect.x} + x_{\text{norm}} \times \text{rect.width}$$
$$Y = \text{rect.y} + y_{\text{norm}} \times \text{rect.height}$$

This ensures overlays align with objects without scaling distortion.

---

## 4. Single-Sided Detection Pipeline

To avoid double-inference and CPU waste, detections are processed on-device (Mobile) and rendered locally, while detection results are relayed over Socket.IO to the desktop for remote visualization and metric computation.
