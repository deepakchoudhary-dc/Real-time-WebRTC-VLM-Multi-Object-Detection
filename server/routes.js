'use strict';

const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('./config');
const logger = require('./logger');
const { getValidHost, issueCsrfToken, verifyAndConsumeCsrfToken } = require('./security');
const { roomStore } = require('./room-store');
const { metricsStore } = require('./metrics');
const { httpRateLimiter } = require('./rate-limiter');
const { getPrimaryLANIP } = require('./tls');

function attachRoutes(app) {
  // ── 1. QR Code & Room Initialization (N05) ────────────────────────
  app.get('/api/qr', httpRateLimiter, async (req, res) => {
    try {
      const validHost = getValidHost(req);
      const portPart = config.PORT !== 443 ? `:${config.PORT}` : '';
      
      let baseUrl;
      if (config.PUBLIC_URL) {
        baseUrl = config.PUBLIC_URL;
      } else if (validHost) {
        baseUrl = `https://${validHost}`;
      } else {
        const lanIp = getPrimaryLANIP();
        baseUrl = `https://${lanIp}${portPart}`;
      }

      const room = roomStore.createRoom();
      const phoneUrl = `${baseUrl}/phone?room=${encodeURIComponent(room.code)}&token=${encodeURIComponent(room.phoneToken)}`;

      const qrCode = await QRCode.toDataURL(phoneUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M'
      });

      res.json({
        qr: qrCode,
        url: phoneUrl,
        roomCode: room.code,
        desktopToken: room.desktopToken,
        token: room.phoneToken,
        csrfToken: issueCsrfToken()
      });
    } catch (error) {
      logger.error(`Failed to generate QR code: ${error.message}`);
      res.status(500).json({ error: 'Failed to generate room and QR code.' });
    }
  });

  // ── 2. ICE / STUN / TURN Configuration ───────────────────────────
  app.get('/api/ice-config', httpRateLimiter, (req, res) => {
    const iceServers = [];

    // Default STUN servers
    for (const stunUrl of config.STUN_URLS) {
      iceServers.push({ urls: stunUrl });
    }

    // Configured TURN server with optional time-limited HMAC credentials
    if (config.TURN_URL) {
      if (config.TURN_SECRET) {
        // Coturn REST API ephemeral credential generation (RFC 5766 / Turn REST API)
        const ttlSeconds = 86400; // 24h
        const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
        const username = `${expiry}:webrtc-user`;
        const hmac = crypto.createHmac('sha1', config.TURN_SECRET);
        hmac.update(username);
        const credential = hmac.digest('base64');

        iceServers.push({
          urls: config.TURN_URL,
          username,
          credential
        });
      } else if (config.TURN_USERNAME && config.TURN_CREDENTIAL) {
        iceServers.push({
          urls: config.TURN_URL,
          username: config.TURN_USERNAME,
          credential: config.TURN_CREDENTIAL
        });
      } else {
        iceServers.push({ urls: config.TURN_URL });
      }
    }

    res.json({ iceServers });
  });

  // ── 3. Performance Metrics (Sanitized, no connection count leak) ───
  app.get('/api/metrics', httpRateLimiter, (req, res) => {
    const snapshot = metricsStore.getSnapshot();
    res.json(snapshot);
  });

  // ── 4. Reset Metrics (Protected with per-session CSRF token, N12) ──
  app.post('/api/reset-metrics', httpRateLimiter, (req, res) => {
    if (!verifyAndConsumeCsrfToken(req)) {
      return res.status(403).json({ error: 'Invalid or expired CSRF token.' });
    }
    metricsStore.reset();
    res.json({ message: 'Metrics successfully reset.' });
  });

  // ── 5. Health Check ───────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  // ── 6. Page Routes ────────────────────────────────────────────────
  app.get('/phone', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/phone.html'));
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });
}

module.exports = {
  attachRoutes
};
