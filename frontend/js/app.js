/**
 * Desktop Application — WebRTC Object Detection
 *
 * Receives video stream from phone via WebRTC,
 * runs COCO-SSD detection locally on the desktop browser,
 * and draws bounding box overlays on a canvas.
 */
class WebRTCObjectDetection {
  constructor() {
    this.socket = io();
    this.peerConnection = null;
    this.remoteStream = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.roomCode = null;
    this.detector = window.objectDetector;

    // Detection state
    this.isDetecting = false;
    this.detectionLoop = null;
    this.detectionInterval = 150; // ms between detections (~7 FPS detection)

    // Performance tracking
    this.latencyHistory = [];
    this.fpsHistory = [];
    this.maxHistoryLength = 60;

    this.metrics = {
      frameCount: 0,
      processedCount: 0,
      lastFpsUpdate: Date.now(),
      fpsCounter: 0,
      currentFps: 0,
    };

    // Detection display
    this.lastDetections = [];
    this.lastDetectionTime = 0;
    this.detectionDisplayDuration = 2500;
    this.detectionHistory = [];

    // Performance chart
    this.performanceChart = null;

    this.init();
  }

  async init() {
    this.setupCanvas();
    this.setupWebRTC();
    this.setupSocketEvents();
    this.generateRoom();
    this.initPerformanceChart();
    this.startMetricsUpdate();

    // Load AI model with progress
    this.showModelLoadingUI();
    const loaded = await this.detector.loadModel((progress) => {
      this.updateModelProgress(progress);
    });

    if (loaded) {
      this.hideModelLoadingUI();
    } else {
      this.showModelError();
    }
  }

  // ── Model Loading UI ──

  showModelLoadingUI() {
    const el = document.getElementById('modelStatus');
    if (el) {
      el.style.display = 'block';
      el.textContent = '🧠 Loading AI model...';
    }
  }

  updateModelProgress(progress) {
    const el = document.getElementById('modelStatus');
    if (el) {
      el.textContent = `🧠 Loading AI model... ${progress}%`;
    }
  }

  hideModelLoadingUI() {
    const el = document.getElementById('modelStatus');
    if (el) {
      el.textContent = '✅ AI model ready';
      setTimeout(() => {
        el.style.display = 'none';
      }, 2000);
    }
  }

  showModelError() {
    const el = document.getElementById('modelStatus');
    if (el) {
      el.textContent = '❌ Failed to load AI model. Refresh to retry.';
      el.style.background = 'rgba(255, 71, 87, 0.4)';
    }
  }

  // ── Canvas Setup ──

  setupCanvas() {
    this.overlayCanvas = document.getElementById('overlayCanvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
  }

  resizeCanvas() {
    const video = document.getElementById('remoteVideo');
    const rect = video.getBoundingClientRect();

    this.overlayCanvas.style.width = rect.width + 'px';
    this.overlayCanvas.style.height = rect.height + 'px';

    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Room & QR Code ──

  async generateRoom() {
    try {
      const response = await fetch('/api/qr');
      const data = await response.json();

      this.roomCode = data.roomCode;

      // Join room as desktop
      this.socket.emit('join-room', {
        roomCode: this.roomCode,
        role: 'desktop',
      });

      // Display QR code
      const qrEl = document.getElementById('qrCode');
      if (qrEl) {
        const img = document.createElement('img');
        img.src = data.qr;
        img.alt = 'Scan to connect phone';
        qrEl.innerHTML = '';
        qrEl.appendChild(img);
      }

      const urlEl = document.getElementById('connectionUrl');
      if (urlEl) {
        urlEl.textContent = data.url;
      }

      const roomEl = document.getElementById('roomCode');
      if (roomEl) {
        roomEl.textContent = this.roomCode;
      }
    } catch (error) {
      console.error('Failed to generate room:', error);
    }
  }

  // ── WebRTC ──

  setupWebRTC() {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.ontrack = (event) => {
      console.log('📺 Received remote video stream');
      this.remoteStream = event.streams[0];
      this.setupRemoteVideo();
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('🔗 Connection state:', state);
      this.updateConnectionStatus(state);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', event.candidate);
      }
    };
  }

  // ── Socket Events ──

  setupSocketEvents() {
    this.socket.on('offer', async (offer) => {
      console.log('📞 Received offer from phone');
      try {
        await this.peerConnection.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.socket.emit('answer', answer);
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    });

    this.socket.on('ice-candidate', async (candidate) => {
      try {
        await this.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    });

    // Receive detection results from phone
    this.socket.on('detection-result', (result) => {
      if (result && Array.isArray(result.detections)) {
        this.handleDetectionResult(result);
      }
    });

    this.socket.on('peer-joined', (data) => {
      console.log(`📱 ${data.role} joined the room`);
    });

    this.socket.on('peer-left', (data) => {
      console.log(`📱 ${data.role} left the room`);
      this.updateConnectionStatus('disconnected');
    });
  }

  // ── Remote Video ──

  setupRemoteVideo() {
    const video = document.getElementById('remoteVideo');
    const loading = document.getElementById('loadingIndicator');

    video.srcObject = this.remoteStream;
    video.style.display = 'block';
    if (loading) loading.style.display = 'none';

    video.onloadedmetadata = () => {
      this.resizeCanvas();
      this.startDetectionLoop();
      this.startPersistentDisplay();
    };

    video.onresize = () => this.resizeCanvas();
  }

  // ── Detection Loop (runs on desktop) ──

  startDetectionLoop() {
    if (this.detectionLoop) return;

    const runDetection = async () => {
      if (this.isDetecting) return;
      this.isDetecting = true;

      try {
        const video = document.getElementById('remoteVideo');
        if (video && video.readyState >= 2 && this.detector.modelLoaded) {
          const captureTs = Date.now();
          const detections = await this.detector.detect(video);

          this.metrics.processedCount++;
          this.metrics.fpsCounter++;

          const result = {
            capture_ts: captureTs,
            inference_ts: Date.now(),
            detections,
          };

          this.handleDetectionResult(result);
        }
      } catch (error) {
        console.error('Detection loop error:', error);
      } finally {
        this.isDetecting = false;
      }
    };

    this.detectionLoop = setInterval(runDetection, this.detectionInterval);
  }

  // ── Handle Detection Results ──

  handleDetectionResult(result) {
    const now = Date.now();
    const latency = result.inference_ts
      ? result.inference_ts - result.capture_ts
      : 0;

    // Update metrics
    this.metrics.processedCount++;
    this.metrics.fpsCounter++;

    // Track latency
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.maxHistoryLength) {
      this.latencyHistory.shift();
    }

    // Store detections for persistent display
    if (result.detections && result.detections.length > 0) {
      this.lastDetections = result.detections;
      this.lastDetectionTime = now;
    }

    // Draw overlays
    this.drawPersistentDetections();

    // Update UI
    this.updateDetectionList(result.detections || []);
    this.updateLiveMetrics(latency, (result.detections || []).length);
  }

  // ── Drawing ──

  drawPersistentDetections() {
    const now = Date.now();
    const elapsed = now - this.lastDetectionTime;

    this.overlayCtx.clearRect(
      0,
      0,
      this.overlayCanvas.width,
      this.overlayCanvas.height
    );

    if (
      elapsed < this.detectionDisplayDuration &&
      this.lastDetections.length > 0
    ) {
      const fadeStart = this.detectionDisplayDuration - 500;
      let opacity = 1.0;
      if (elapsed > fadeStart) {
        opacity = 1.0 - (elapsed - fadeStart) / 500;
      }
      this.drawDetections(this.lastDetections, opacity);
    }
  }

  drawDetections(detections, opacity = 1.0) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    this.overlayCtx.globalAlpha = opacity;

    // Color palette for different classes
    const colors = [
      '#ff6b6b', '#51cf66', '#339af0', '#fcc419',
      '#cc5de8', '#20c997', '#ff922b', '#845ef7',
      '#f06595', '#22b8cf', '#fab005', '#7950f2',
    ];

    detections.forEach((det, i) => {
      const color = colors[i % colors.length];
      const x = det.xmin * rect.width;
      const y = det.ymin * rect.height;
      const w = (det.xmax - det.xmin) * rect.width;
      const h = (det.ymax - det.ymin) * rect.height;

      // Bounding box
      this.overlayCtx.strokeStyle = color;
      this.overlayCtx.lineWidth = 2.5;
      this.overlayCtx.strokeRect(x, y, w, h);

      // Corner accents
      const cornerLen = Math.min(w, h) * 0.15;
      this.overlayCtx.lineWidth = 4;
      // Top-left
      this.overlayCtx.beginPath();
      this.overlayCtx.moveTo(x, y + cornerLen);
      this.overlayCtx.lineTo(x, y);
      this.overlayCtx.lineTo(x + cornerLen, y);
      this.overlayCtx.stroke();
      // Top-right
      this.overlayCtx.beginPath();
      this.overlayCtx.moveTo(x + w - cornerLen, y);
      this.overlayCtx.lineTo(x + w, y);
      this.overlayCtx.lineTo(x + w, y + cornerLen);
      this.overlayCtx.stroke();
      // Bottom-left
      this.overlayCtx.beginPath();
      this.overlayCtx.moveTo(x, y + h - cornerLen);
      this.overlayCtx.lineTo(x, y + h);
      this.overlayCtx.lineTo(x + cornerLen, y + h);
      this.overlayCtx.stroke();
      // Bottom-right
      this.overlayCtx.beginPath();
      this.overlayCtx.moveTo(x + w - cornerLen, y + h);
      this.overlayCtx.lineTo(x + w, y + h);
      this.overlayCtx.lineTo(x + w, y + h - cornerLen);
      this.overlayCtx.stroke();

      // Label
      const label = `${det.label} ${Math.round(det.score * 100)}%`;
      this.overlayCtx.font = 'bold 13px Inter, Arial, sans-serif';
      const tm = this.overlayCtx.measureText(label);
      const labelH = 22;
      const labelY = y > labelH + 4 ? y - labelH - 2 : y + 2;

      this.overlayCtx.fillStyle = color;
      this.overlayCtx.beginPath();
      this.roundRect(x, labelY, tm.width + 12, labelH, 4);
      this.overlayCtx.fill();

      this.overlayCtx.fillStyle = '#fff';
      this.overlayCtx.fillText(label, x + 6, labelY + 15);
    });

    this.overlayCtx.globalAlpha = 1.0;
  }

  roundRect(x, y, w, h, r) {
    this.overlayCtx.moveTo(x + r, y);
    this.overlayCtx.lineTo(x + w - r, y);
    this.overlayCtx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.overlayCtx.lineTo(x + w, y + h - r);
    this.overlayCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.overlayCtx.lineTo(x + r, y + h);
    this.overlayCtx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.overlayCtx.lineTo(x, y + r);
    this.overlayCtx.quadraticCurveTo(x, y, x + r, y);
  }

  startPersistentDisplay() {
    const update = () => {
      this.drawPersistentDetections();
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  // ── Detection List UI ──

  updateDetectionList(detections) {
    const now = Date.now();

    detections.forEach((d) => {
      this.detectionHistory.push({
        label: d.label,
        confidence: d.score,
        timestamp: now,
      });
    });

    // Keep last 10s
    this.detectionHistory = this.detectionHistory.filter(
      (d) => now - d.timestamp < 10_000
    );

    // Unique labels, newest first
    const seen = new Set();
    const unique = [];
    for (const d of [...this.detectionHistory].reverse()) {
      if (!seen.has(d.label)) {
        seen.add(d.label);
        unique.push(d);
      }
    }

    const listEl = document.getElementById('detectionList');
    if (!listEl) return;

    if (unique.length === 0) {
      listEl.textContent = '';
      const empty = document.createElement('div');
      empty.style.cssText = 'color: #999; text-align: center; padding: 20px;';
      empty.textContent = 'No recent detections';
      listEl.appendChild(empty);
    } else {
      listEl.textContent = '';
      unique.slice(0, 6).forEach((d) => {
        const item = document.createElement('div');
        item.className = 'detection-item';
        item.textContent = `${d.label} — ${Math.round(d.confidence * 100)}%`;
        listEl.appendChild(item);
      });
    }
  }

  // ── Metrics UI ──

  updateLiveMetrics(latency, objectCount) {
    const latencyEl = document.getElementById('latencyMetric');
    const objectsEl = document.getElementById('objectsMetric');
    if (latencyEl) latencyEl.textContent = `${latency}ms`;
    if (objectsEl) objectsEl.textContent = objectCount;

    const now = Date.now();
    if (now - this.metrics.lastFpsUpdate >= 1000) {
      const fps = this.metrics.fpsCounter;
      const fpsEl = document.getElementById('fpsMetric');
      const processedEl = document.getElementById('processedMetric');
      if (fpsEl) fpsEl.textContent = `${fps} fps`;
      if (processedEl) processedEl.textContent = this.metrics.processedCount;

      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > this.maxHistoryLength) {
        this.fpsHistory.shift();
      }

      this.metrics.currentFps = fps;
      this.metrics.fpsCounter = 0;
      this.metrics.lastFpsUpdate = now;

      if (this.performanceChart) this.updatePerformanceChart();
    }
  }

  updateConnectionStatus(state) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;

    const map = {
      connected: ['status-connected', '📱 Connected'],
      connecting: ['status-connecting', '📱 Connecting...'],
    };
    const [cls, text] = map[state] || [
      'status-disconnected',
      '📱 Disconnected',
    ];
    el.className = `connection-status ${cls}`;
    el.textContent = text;
  }

  // ── Performance Chart ──

  initPerformanceChart() {
    const canvas = document.getElementById('latencyChart');
    if (!canvas) return;
    this.performanceChart = {
      canvas,
      ctx: canvas.getContext('2d'),
      width: canvas.width,
      height: canvas.height,
    };
  }

  updatePerformanceChart() {
    if (!this.performanceChart) return;
    const { ctx, width, height } = this.performanceChart;

    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = (height * i) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Latency line
    if (this.latencyHistory.length > 1) {
      const max = Math.max(...this.latencyHistory, 200);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.latencyHistory.forEach((v, i) => {
        const x = (width * i) / (this.maxHistoryLength - 1);
        const y = height - (height * v) / max;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // FPS line
    if (this.fpsHistory.length > 1) {
      const max = Math.max(...this.fpsHistory, 30);
      ctx.strokeStyle = '#51cf66';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.fpsHistory.forEach((v, i) => {
        const x = (width * i) / (this.maxHistoryLength - 1);
        const y = height - (height * v) / max;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px Inter, Arial, sans-serif';
    ctx.fillText('Latency (red)', 5, 14);
    ctx.fillText('FPS (green)', 5, 28);
  }

  startMetricsUpdate() {
    // Lightweight periodic server metrics fetch
    setInterval(async () => {
      try {
        await fetch('/api/metrics');
      } catch {
        // Ignore fetch errors silently
      }
    }, 10_000);
  }
}

// ── Global Button Handlers ──

async function runBenchmark() {
  const btn = document.getElementById('benchmarkBtn');
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = '⏱️ Running (30s)...';
  btn.disabled = true;

  try {
    await fetch('/api/reset-metrics', { method: 'POST' });
    await new Promise((r) => setTimeout(r, 30_000));

    const res = await fetch('/api/metrics');
    const data = await res.json();

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metrics.json';
    a.click();
    URL.revokeObjectURL(url);

    alert(
      `Benchmark complete!\n` +
      `Median latency: ${data.median_latency_ms}ms\n` +
      `P95 latency: ${data.p95_latency_ms}ms\n` +
      `FPS: ${data.processed_fps}`
    );
  } catch (error) {
    console.error('Benchmark failed:', error);
    alert('Benchmark failed. Is the server running?');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

async function resetMetrics() {
  try {
    await fetch('/api/reset-metrics', { method: 'POST' });
  } catch (error) {
    console.error('Failed to reset metrics:', error);
  }
}

async function downloadMetrics() {
  try {
    const res = await fetch('/api/metrics');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metrics.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download metrics:', error);
  }
}

function togglePerformanceChart() {
  const chart = document.getElementById('performanceChart');
  const btn = document.getElementById('performanceBtn');
  if (!chart || !btn) return;
  const visible = chart.style.display !== 'none';
  chart.style.display = visible ? 'none' : 'block';
  btn.textContent = visible ? '📈 Performance Chart' : '📈 Hide Chart';
}

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  new WebRTCObjectDetection();
});
