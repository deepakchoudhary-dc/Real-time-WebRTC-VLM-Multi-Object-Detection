const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const cors = require('cors');
const selfsigned = require('selfsigned');

const app = express();

// Generate self-signed certificate
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

const server = https.createServer({
  key: pems.private,
  cert: pems.cert
}, app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3443;
const MODE = process.env.MODE || 'wasm';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Store active connections
const connections = new Map();
const metrics = {
  totalFrames: 0,
  processedFrames: 0,
  latencies: [],
  startTime: Date.now()
};

// WebRTC signaling and detection pipeline
io.on('connection', (socket) => {
  console.log(`🔗 Client connected: ${socket.id}`);
  
  connections.set(socket.id, {
    socket,
    frameQueue: [],
    lastProcessTime: 0,
    stats: {
      framesReceived: 0,
      framesProcessed: 0,
      avgLatency: 0
    }
  });

  // Handle WebRTC signaling
  socket.on('offer', (offer) => {
    console.log('📞 Received offer from client');
    socket.broadcast.emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    console.log('✅ Received answer from peer');
    socket.broadcast.emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate) => {
    socket.broadcast.emit('ice-candidate', candidate);
  });

  // Handle video frames for processing
  socket.on('video-frame', async (frameData) => {
    const connection = connections.get(socket.id);
    if (!connection) return;

    const frame = {
      ...frameData,
      recv_ts: Date.now(),
      socket_id: socket.id
    };

    connection.stats.framesReceived++;
    metrics.totalFrames++;

    // Backpressure: maintain queue size
    if (connection.frameQueue.length >= 3) {
      connection.frameQueue.shift(); // Drop oldest frame
    }
    
    connection.frameQueue.push(frame);
    
    // Process frame based on mode
    processFrame(connection, frame);
  });

  // Handle detection results from phone and relay to desktop
  socket.on('detection-result', (detectionResult) => {
    console.log(`📱➡️🖥️ Relaying detection result: ${detectionResult.detections.length} objects`);
    
    // Broadcast detection result to all other connected clients (desktop)
    socket.broadcast.emit('detection-result', detectionResult);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    connections.delete(socket.id);
  });
});

// Frame processing function
async function processFrame(connection, frame) {
  const now = Date.now();
  
  // Adaptive FPS: throttle processing if overloaded
  if (now - connection.lastProcessTime < 66) { // ~15 FPS max
    return;
  }
  
  connection.lastProcessTime = now;
  
  try {
    // In WASM mode, do NOT send fake detections
    // Just signal client to process locally
    connection.socket.emit('process-frame-wasm', {
      frame_id: frame.frame_id,
      capture_ts: frame.capture_ts,
      recv_ts: frame.recv_ts
    });
    return; // Don't send any server-side detections
  } catch (error) {
    console.error('❌ Frame processing error:', error);
  }
}

// Server-side inference (disabled in WASM mode)
async function processFrameServer(frame) {
  // In WASM mode, detection should happen on client side
  // Return empty detections to avoid fake results
  console.log('⚠️  Server-side detection called in WASM mode - this should not happen');
  return [];
}

// Get local IP address
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  
  // Prefer Wi-Fi or Ethernet interfaces over virtual ones
  const preferredInterfaces = ['Wi-Fi', 'Ethernet', 'eth0', 'en0'];
  
  // First try preferred interfaces
  for (const preferred of preferredInterfaces) {
    if (nets[preferred]) {
      for (const net of nets[preferred]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }
  
  // Fallback to any non-internal IPv4 address
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  
  return '127.0.0.1';
}

// API endpoints
app.get('/api/qr', async (req, res) => {
  try {
    // Get the actual host from the request - this will be the correct IP
    const host = req.get('host');
    const protocol = 'https'; // Always HTTPS now
    const url = `${protocol}://${host}/phone`;
    
    const qrCode = await QRCode.toDataURL(url);
    res.json({ qr: qrCode, url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/metrics', (req, res) => {
  const now = Date.now();
  const duration = (now - metrics.startTime) / 1000;
  
  // Calculate statistics
  const sortedLatencies = metrics.latencies.sort((a, b) => a - b);
  const median = sortedLatencies.length > 0 
    ? sortedLatencies[Math.floor(sortedLatencies.length / 2)] 
    : 0;
  const p95 = sortedLatencies.length > 0 
    ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] 
    : 0;
  
  const stats = {
    mode: MODE,
    duration_seconds: Math.round(duration),
    total_frames: metrics.totalFrames,
    processed_frames: metrics.processedFrames,
    median_latency_ms: Math.round(median),
    p95_latency_ms: Math.round(p95),
    processed_fps: duration > 0 ? Math.round((metrics.processedFrames / duration) * 10) / 10 : 0,
    active_connections: connections.size
  };
  
  res.json(stats);
});

app.get('/api/reset-metrics', (req, res) => {
  metrics.totalFrames = 0;
  metrics.processedFrames = 0;
  metrics.latencies = [];
  metrics.startTime = Date.now();
  
  res.json({ message: 'Metrics reset' });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/phone.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    mode: MODE,
    connections: connections.size,
    uptime: process.uptime()
  });
});

// Start server - listen on all interfaces (0.0.0.0) not just localhost
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`🚀 HTTPS Server running on port ${PORT}`);
  console.log(`📱 Mode: ${MODE}`);
  console.log(`🌐 Open https://localhost:${PORT} to start (desktop)`);
  console.log(`📱 Phone: Access https://${localIP}:${PORT}/phone`);
  console.log(`📡 Server listening on all interfaces (0.0.0.0:${PORT})`);
  console.log(`🔥 Local IP detected: ${localIP}`);
  console.log(`⚠️  You will need to accept the security warning for self-signed certificate`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
