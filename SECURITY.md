# 🔒 Security Policy & Threat Model

## Threat Model & Security Guarantees

This project implements a defense-in-depth security model tailored for real-time video streaming across local and wireless networks.

### 1. Room Authentication & Token Binding (F-01, F-02, F-11)
- **Room Codes:** Generated using `crypto.randomInt` from an unambiguous 30-character alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), providing 729+ million combinations for 6-character codes.
- **Room Tokens:** A 128-bit cryptographic token (`crypto.randomBytes(16)`) is generated per room.
- **Role Enforcement:** Joining as a `phone` requires presenting the exact room token. Unauthenticated strangers cannot guess room codes or inject themselves into existing rooms to intercept streams.
- **Slot Isolation:** Each room strictly allows one `desktop` socket and one `phone` socket. Attempts by 3rd parties to occupy an active slot are rejected.

### 2. Point-to-Peer Signaling Isolation (F-04, F4)
- WebRTC SDP offers/answers and ICE candidates are routed exclusively to the designated peer's socket ID (`io.to(peerSocketId)`), completely eliminating broadcast leaks across room participants.

### 3. Subject Alternative Name (SAN) Dynamic TLS (F-15)
- In-memory dynamic self-signed certificates include SAN extensions for `localhost`, `127.0.0.1`, and all detected LAN IPv4 addresses.
- Private keys exist solely in volatile process memory and are never persisted to disk or git history.

### 4. Injection & Poisoning Prevention (F-06, F-16)
- The host header in `/api/qr` and HTTP redirection is validated against allowed hostname patterns, preventing cache poisoning and host-header injection.

### 5. CSRF Protection (F-05)
- Destructive and administrative endpoints like `/api/reset-metrics` require an `X-CSRF-Token` header validated using constant-time string comparison (`crypto.timingSafeEqual`).

### 6. Event Rate Limiting & Resource Caps (F-03, F-09, F-17)
- **HTTP Limiter:** Capped per IP address (120 requests / minute).
- **Socket Token Bucket:** Capped per connection (60 events / second) to prevent signaling flood attacks and CPU exhaustion.
- **Room TTL & Garbage Collection:** Rooms expire after 30 minutes; an automatic sweep cleans abandoned rooms every 5 minutes.
- **Metrics Ring Buffer:** Fixed at 1,000 samples with strict `Number.isFinite()` guards preventing `NaN` or `null` metric corruptions.

---

## Reporting a Vulnerability

If you discover a security vulnerability, please open a private GitHub security advisory or report it directly to the repository maintainers.
