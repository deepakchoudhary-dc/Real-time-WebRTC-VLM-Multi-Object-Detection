# 🚀 Production Deployment & Infrastructure Guide

This guide details deployment options, container configuration, reverse proxy setups, and Coturn (TURN) integration.

---

## 1. Docker Compose (Recommended)

Run the hardened container stack in a single command:

```bash
docker-compose up --build -d
```

### Security & Resource Limits
The `docker-compose.yml` provides production hardening:
- **Non-Root Execution:** Runs under standard `node` user (`UID 1000`).
- **Capability Drop:** Drops all Linux kernel capabilities (`cap_drop: [ALL]`).
- **Resource Constraints:** 
  - CPU limit: `2.0 cores` (reservation: `0.25 cores`)
  - Memory limit: `512 MB` (reservation: `128 MB`)
- **Log Rotation:** JSON file logging capped at `10MB` with `3` rolling archives.
- **Healthcheck:** Automatic HTTPS container health monitoring against `/health`.

---

## 2. Standalone Node.js (Systemd)

### Prerequisites
- Node.js >= 20 LTS installed.
- Open firewall ports `3443` (HTTPS) and `3000` (HTTP redirect).

### Systemd Service Setup
Create `/etc/systemd/system/webrtc-vision.service`:

```ini
[Unit]
Description=WebRTC Object Detection Hub
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/webrtc-vision
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production
Environment=PORT=3443
Environment=HTTP_PORT=3000

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now webrtc-vision
```

---

## 3. Reverse Proxy & Let's Encrypt (Nginx / Caddy)

### Caddy (Automatic TLS)
```caddyfile
vision.example.com {
    reverse_proxy https://localhost:3443 {
        transport http {
            tls_insecure_skip_verify
        }
    }
}
```

### Nginx
```nginx
server {
    listen 80;
    server_name vision.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vision.example.com;

    ssl_certificate /etc/letsencrypt/live/vision.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vision.example.com/privkey.pem;

    location / {
        proxy_pass https://127.0.0.1:3443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 4. Coturn (TURN / STUN) Integration

For mobile cellular networks or symmetric NAT where direct P2P connections cannot traverse firewalls, deploy a Coturn server.

### Coturn Configuration (`/etc/turnserver.conf`)
```ini
listening-port=3478
tls-listening-port=5349
realm=vision.example.com
use-auth-secret
static-auth-secret=YOUR_COTURN_SHARED_SECRET_HEX
min-port=49152
max-port=65535
```

### WebRTC Vision Configuration (`.env`)
```env
TURN_URL=turns:vision.example.com:5349
TURN_SECRET=YOUR_COTURN_SHARED_SECRET_HEX
```

When `TURN_SECRET` is configured, `/api/ice-config` will automatically compute and dispense time-limited ephemeral HMAC credentials to connecting mobile and desktop clients according to RFC 5766.

---

## 5. Environment Variables Reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3443` | HTTPS server listening port |
| `HTTP_PORT` | `3000` | HTTP redirect server port |
| `NODE_ENV` | `development` | Environment (`production` or `development`) |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `MAX_ROOMS` | `100` | Maximum active concurrent session rooms |
| `ROOM_TTL_MS` | `1800000` | Room expiration inactivity window (30 mins) |
| `MAX_CONNECTIONS`| `100` | Global concurrent socket connection cap |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | HTTP rate limit window max requests |
| `PUBLIC_URL` | `null` | Optional canonical URL for QR generation |
| `TURN_URL` | `null` | Coturn STUN/TURN server URL |
| `TURN_SECRET` | `null` | Coturn shared secret for HMAC credentials |
