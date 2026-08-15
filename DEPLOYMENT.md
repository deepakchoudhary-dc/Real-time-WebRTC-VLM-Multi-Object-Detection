# 🚀 Production Deployment & Operations Guide

This guide covers production deployment configurations, containerization, Coturn TURN server setup, and environment variables.

---

## 1. Environment Configuration

All configuration variables can be defined via environment variables or a `.env` file in the project root:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | Application environment (`development` / `production`) |
| `PORT` | `3443` | Main HTTPS and WebSockets server port |
| `HTTP_PORT` | `3000` | Port for automatic HTTP -> HTTPS redirection |
| `PUBLIC_URL` | `null` | Canonical public URL (e.g., `https://vision.example.com`) |
| `HOST_WHITELIST` | `null` | Comma-separated list of allowed hostnames |
| `RATE_LIMIT_WINDOW_MS` | `60000` | HTTP rate limiter sliding window duration in ms |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Maximum HTTP requests per IP per window |
| `SOCKET_RATE_LIMIT_WINDOW_MS` | `1000` | Socket event token bucket window in ms |
| `SOCKET_RATE_LIMIT_MAX_EVENTS` | `60` | Maximum socket events per connection per second |
| `MAX_ROOMS` | `100` | Maximum concurrent active rooms in memory |
| `ROOM_TTL_MS` | `1800000` | Room expiry window (30 minutes of complete inactivity) |
| `ROOM_ABANDONMENT_TTL_MS` | `300000` | Abandoned room expiry window (5 minutes without peers) |
| `ROOM_GC_INTERVAL_MS` | `60000` | Frequency of background room GC sweeps (60s) |
| `MAX_CONNECTIONS` | `100` | Hard cap on total simultaneous client socket connections |
| `MAX_LATENCY_SAMPLES` | `1000` | Bounded capacity of the latency measurement ring buffer |
| `MAX_PAYLOAD_BYTES` | `262144` | Maximum Socket.IO message payload size (256 KB) |
| `STUN_URLS` | Google STUN | Comma-separated list of STUN servers |
| `TURN_URL` | `null` | TURN server URL (e.g. `turn:turn.example.com:3478`) |
| `TURN_USERNAME` | `null` | Static TURN username |
| `TURN_CREDENTIAL` | `null` | Static TURN password |
| `TURN_SECRET` | `null` | Shared secret for ephemeral HMAC credentials (RFC 7635) |
| `TURN_TTL_SECONDS` | `86400` | Lifetime in seconds for ephemeral TURN credentials |

---

## 2. Coturn TURN Server Setup (RFC 7635)

For cross-network connections where peers are behind symmetric NATs or restrictive firewalls, deploy a Coturn TURN server.

### Coturn Configuration (`/etc/turnserver.conf`)
```ini
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=YOUR_PUBLIC_IP

# Ephemeral HMAC Token Authentication (RFC 7635)
use-auth-secret
static-auth-secret=YOUR_SECURE_RANDOM_SECRET_KEY
realm=turn.yourdomain.com

# Performance & Security
fingerprint
stale-nonce=600
no-stdout-log
log-file=/var/log/turnserver.log
```

---

## 3. Docker Compose Deployment

Run with Docker Compose with non-root security:

```bash
docker-compose up -d --build
```

Access at `https://localhost:3443` (HTTP on `3000` automatically redirects to HTTPS `3443`).
