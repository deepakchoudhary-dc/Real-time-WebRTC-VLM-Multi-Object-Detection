const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const cors = require('cors');
const selfsigned = require('selfsigned');

// ─── Configuration ───────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3443;
const HTTP_PORT = parseInt(process.env.HTTP_PORT, 10) || 3000;
const MAX_LATENCY_SAMPLES = 1000;
const MAX_CONNECTIONS = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const MAX_FRAME_PAYLOAD_BYTES = 1_048_576; // 1 MB

// ─── TLS Certificate (generated at runtime, never stored) ────────
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, {
  days: 30,
  keySize: 2048,
  algorithm: 'sha256',
});

// ─── Express App ─────────────────────────────────────────────────
const app = express();

// Security headers (manual — no helmet dependency needed)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self' wss: ws:;"
  );
  next();
});

// CORS — restrict to same-origin requests (localhost + LAN IP)
const allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (same-origin, curl, mobile apps)
      if (!origin || allowedOriginPattern.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error('CORS: origin not allowed'));
      }
    },
    methods: ['GET'],
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Simple In-Memory Rate Limiter ──────────────────────────────
const rateLimitMap = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  let record = rateLimitMap.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, record);
  }

  record.count++;

  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  next();
}

// Periodically clean stale rate-limit entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 300_000);

// ─── Metrics (Ring Buffer) ───────────────────────────────────────
const metrics = {
  totalFrames: 0,
  processedFrames: 0,
  latencies: [],
  latencyIndex: 0,
  startTime: Date.now(),
};

function recordLatency(latency) {
  if (typeof latency !== 'number' || latency < 0 || latency > 60_000) return;

  if (metrics.latencies.length < MAX_LATENCY_SAMPLES) {
    metrics.latencies.push(latency);
  } else {
    metrics.latencies[metrics.latencyIndex] = latency;
  }
  metrics.latencyIndex = (metrics.latencyIndex + 1) % MAX_LATENCY_SAMPLES;
}

// ─── Connection Store ────────────────────────────────────────────
const rooms = new Map(); // roomCode -> { desktop: socketId, phone: socketId }
const connections = new Map();

// ─── HTTPS + HTTP Servers ────────────────────────────────────────
const httpsServer = https.createServer(
  { key: pems.private, cert: pems.cert },
  app
);

// HTTP redirect server
const httpApp = express();
httpApp.use((req, res) => {
  const host = (req.headers.host || 'localhost').replace(`:${HTTP_PORT}`, `:${PORT}`);
  res.redirect(301, `https://${host}${req.url}`);
});
const httpServer = http.createServer(httpApp);

// ─── Socket.IO with Security ────────────────────────────────────
const io = socketIo(httpsServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || allowedOriginPattern.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error('CORS: origin not allowed'));
      }
    },
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: MAX_FRAME_PAYLOAD_BYTES,
  pingTimeout: 20_000,
  pingInterval: 10_000,
});

// ─── Socket.IO Connection Handling ───────────────────────────────
io.on('connection', (socket) => {
  // Enforce connection limit
  if (connections.size >= MAX_CONNECTIONS) {
    console.warn(`⚠️  Connection limit reached. Rejecting ${socket.id}`);
    socket.emit('error-message', { message: 'Server full. Try again later.' });
    socket.disconnect(true);
    return;
  }

  console.log(`🔗 Client connected: ${socket.id}`);

  connections.set(socket.id, {
    room: null,
    role: null, // 'desktop' or 'phone'
    stats: { framesReceived: 0, framesProcessed: 0 },
  });

  // ── Room-based Pairing ──
  socket.on('join-room', (data) => {
    if (!data || typeof data.roomCode !== 'string' || typeof data.role !== 'string') {
      socket.emit('error-message', { message: 'Invalid join-room payload.' });
      return;
    }

    const roomCode = data.roomCode.substring(0, 10).toUpperCase();
    const role = data.role === 'phone' ? 'phone' : 'desktop';

    // Leave previous room if any
    const conn = connections.get(socket.id);
    if (conn && conn.room) {
      socket.leave(conn.room);
    }

    socket.join(roomCode);
    conn.room = roomCode;
    conn.role = role;

    // Track room membership
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, { desktop: null, phone: null });
    }
    const room = rooms.get(roomCode);
    room[role] = socket.id;

    console.log(`📱 ${role} joined room ${roomCode}`);
    socket.to(roomCode).emit('peer-joined', { role });
  });

  // ── WebRTC Signaling (room-scoped) ──
  socket.on('offer', (offer) => {
    const conn = connections.get(socket.id);
    if (!conn?.room || !offer || typeof offer !== 'object') return;
    socket.to(conn.room).emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    const conn = connections.get(socket.id);
    if (!conn?.room || !answer || typeof answer !== 'object') return;
    socket.to(conn.room).emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate) => {
    const conn = connections.get(socket.id);
    if (!conn?.room || !candidate || typeof candidate !== 'object') return;
    socket.to(conn.room).emit('ice-candidate', candidate);
  });

  // ── Detection Results Relay (phone → desktop) ──
  socket.on('detection-result', (result) => {
    const conn = connections.get(socket.id);
    if (!conn?.room) return;

    // Validate detection result structure
    if (!result || !Array.isArray(result.detections)) return;
    if (result.detections.length > 100) return; // Cap detections per frame

    // Validate each detection has required fields
    const validDetections = result.detections.filter(
      (d) =>
        typeof d.label === 'string' &&
        d.label.length <= 50 &&
        typeof d.score === 'number' &&
        d.score >= 0 &&
        d.score <= 1 &&
        typeof d.xmin === 'number' &&
        typeof d.ymin === 'number' &&
        typeof d.xmax === 'number' &&
        typeof d.ymax === 'number'
    );

    // Track metrics
    conn.stats.framesProcessed++;
    metrics.processedFrames++;

    if (typeof result.capture_ts === 'number') {
      const latency = Date.now() - result.capture_ts;
      recordLatency(latency);
    }

    // Relay sanitized result to room
    socket.to(conn.room).emit('detection-result', {
      frame_id: String(result.frame_id || '').substring(0, 64),
      capture_ts: result.capture_ts,
      inference_ts: result.inference_ts,
      detections: validDetections,
    });
  });

  // ── Frame counting (for metrics only — no server-side processing) ──
  socket.on('frame-count', () => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    conn.stats.framesReceived++;
    metrics.totalFrames++;
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const conn = connections.get(socket.id);

    if (conn?.room) {
      socket.to(conn.room).emit('peer-left', { role: conn.role });
      const room = rooms.get(conn.room);
      if (room) {
        if (room[conn.role] === socket.id) {
          room[conn.role] = null;
        }
        // Clean up empty rooms
        if (!room.desktop && !room.phone) {
          rooms.delete(conn.room);
        }
      }
    }

    connections.delete(socket.id);
  });
});

// ─── API Endpoints ───────────────────────────────────────────────
app.get('/api/qr', rateLimit, async (req, res) => {
  try {
    const host = req.get('host');
    // Sanitize host header
    if (!host || host.length > 100) {
      return res.status(400).json({ error: 'Invalid host header.' });
    }
    const roomCode = generateRoomCode();
    const url = `https://${host}/phone?room=${roomCode}`;

    const qrCode = await QRCode.toDataURL(url, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    res.json({ qr: qrCode, url, roomCode });
  } catch (error) {
    console.error('QR generation error:', error.message);
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

app.get('/api/metrics', rateLimit, (req, res) => {
  const now = Date.now();
  const duration = (now - metrics.startTime) / 1000;

  // Calculate statistics from ring buffer (non-mutating)
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const median =
    sorted.length > 0
      ? sorted[Math.floor(sorted.length / 2)]
      : 0;
  const p95 =
    sorted.length > 0
      ? sorted[Math.floor(sorted.length * 0.95)]
      : 0;

  res.json({
    duration_seconds: Math.round(duration),
    total_frames: metrics.totalFrames,
    processed_frames: metrics.processedFrames,
    median_latency_ms: Math.round(median),
    p95_latency_ms: Math.round(p95),
    processed_fps:
      duration > 0
        ? Math.round((metrics.processedFrames / duration) * 10) / 10
        : 0,
    active_connections: connections.size,
    active_rooms: rooms.size,
  });
});

app.post('/api/reset-metrics', rateLimit, (req, res) => {
  metrics.totalFrames = 0;
  metrics.processedFrames = 0;
  metrics.latencies = [];
  metrics.latencyIndex = 0;
  metrics.startTime = Date.now();
  res.json({ message: 'Metrics reset.' });
});

// ── Serve frontend ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/phone.html'));
});

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connections: connections.size,
    rooms: rooms.size,
    uptime: Math.round(process.uptime()),
  });
});

// ─── Helpers ─────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous I/O/0/1
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  const preferred = ['Wi-Fi', 'Ethernet', 'eth0', 'en0', 'wlan0'];
  for (const name of preferred) {
    if (nets[name]) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        !net.address.startsWith('169.254')
      ) {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}

// ─── Start Servers ───────────────────────────────────────────────
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🔀 HTTP → HTTPS redirect on port ${HTTP_PORT}`);
});

httpsServer.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('🚀 WebRTC Object Detection Server');
  console.log('─'.repeat(45));
  console.log(`🔒 HTTPS:   https://localhost:${PORT}`);
  console.log(`📱 Phone:   https://${localIP}:${PORT}/phone`);
  console.log(`🌐 LAN IP:  ${localIP}`);
  console.log(`📡 Listening on 0.0.0.0:${PORT}`);
  console.log('─'.repeat(45));
  console.log('⚠️  Accept the self-signed certificate warning in your browser.');
  console.log('');
});

// ─── Graceful Shutdown ───────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down...`);

  // Close all socket connections
  for (const [id] of connections) {
    io.sockets.sockets.get(id)?.disconnect(true);
  }

  httpsServer.close(() => {
    httpServer.close(() => {
      console.log('✅ Server shut down cleanly.');
      process.exit(0);
    });
  });

  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
