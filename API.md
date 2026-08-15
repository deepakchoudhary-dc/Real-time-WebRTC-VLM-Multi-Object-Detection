# 📡 REST & Socket.IO API Specification

## HTTP REST Endpoints

All endpoints are served over HTTPS. Rate limited to 120 requests/minute per client IP.

### `GET /api/qr`
Generates a new session room and returns an authenticated pairing URL and QR code image.

**Response `200 OK`:**
```json
{
  "qr": "data:image/png;base64,...",
  "url": "https://192.168.1.50:3443/phone?room=ABC123&token=9f3b8c...",
  "roomCode": "ABC123",
  "token": "9f3b8c...",
  "csrfToken": "a1b2c3..."
}
```

---

### `GET /api/ice-config`
Returns STUN and TURN server configuration. If configured with `TURN_SECRET`, returns ephemeral time-limited HMAC credentials.

**Response `200 OK`:**
```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" }
  ]
}
```

---

### `GET /api/metrics`
Returns real-time processing and latency statistics.

**Response `200 OK`:**
```json
{
  "duration_seconds": 120,
  "total_frames": 650,
  "processed_frames": 650,
  "median_latency_ms": 42,
  "p95_latency_ms": 78,
  "min_latency_ms": 18,
  "max_latency_ms": 115,
  "avg_latency_ms": 45,
  "sample_count": 650,
  "processed_fps": 5.4,
  "active_connections": 2,
  "active_rooms": 1
}
```

---

### `POST /api/reset-metrics`
Resets all recorded latency samples and frame counters.

**Headers:**
- `X-CSRF-Token`: `<csrfToken>`

**Response `200 OK`:**
```json
{
  "message": "Metrics successfully reset."
}
```

---

### `GET /health`
Liveness probe endpoint for containers and monitoring.

**Response `200 OK`:**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2026-08-15T10:00:00.000Z"
}
```

---

## Socket.IO Signaling Events

### Client -> Server

| Event | Payload | Description |
| :--- | :--- | :--- |
| `join-room` | `{ roomCode: string, role: "desktop" \| "phone", token?: string }` | Authenticates and joins designated room slot |
| `offer` | `RTCSessionDescriptionInit` | Sends SDP offer (relayed to peer or buffered) |
| `answer` | `RTCSessionDescriptionInit` | Sends SDP answer (relayed to peer) |
| `ice-candidate` | `RTCIceCandidateInit` | Relays ICE candidate to peer |
| `detection-result` | `{ frame_id, capture_ts, inference_ts, detections: [...] }` | Relays AI detection results (Phone only) |

### Server -> Client

| Event | Payload | Description |
| :--- | :--- | :--- |
| `room-joined` | `{ success: boolean, roomCode: string, role: string, hasPeer: boolean }` | Acknowledgment of successful room join |
| `peer-joined` | `{ role: "desktop" \| "phone" }` | Notifies that peer joined room |
| `peer-left` | `{ role: "desktop" \| "phone" }` | Notifies that peer disconnected |
| `offer` | `RTCSessionDescriptionInit` | Incoming SDP offer |
| `answer` | `RTCSessionDescriptionInit` | Incoming SDP answer |
| `ice-candidate` | `RTCIceCandidateInit` | Incoming ICE candidate |
| `detection-result` | `{ frame_id, capture_ts, inference_ts, detections: [...] }` | Sanitized bounding box results |
| `error-message` | `{ error: string }` | Authentication or rate-limit error |
