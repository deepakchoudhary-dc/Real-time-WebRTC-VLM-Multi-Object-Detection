/**
 * Desktop Application — WebRTC Object Detection Hub
 * 
 * Handles P2P WebRTC video stream reception, Perfect Negotiation,
 * single-sided AI bounding box overlays, and live performance metrics.
 */
'use strict';

class DesktopApp {
  constructor() {
    this.socket = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.peerConnection = null;
    this.negotiator = null;
    this.remoteStream = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.resizeObserver = null;

    this.roomCode = null;
    this.desktopToken = null;
    this.csrfToken = null;

    // AI Detector (optional desktop fallback detection, N21)
    this.detector = new window.ObjectDetector();
    this.detectOnDesktop = new URLSearchParams(window.location.search).get('detect') === 'desktop';
    this.desktopDetectionLoop = null;

    // Metrics state (Single-source truth, fixes L25 double count)
    this.processedFrames = 0;
    this.fpsCounter = 0;
    this.currentFps = 0;
    this.lastFpsTimestamp = Date.now();
    this.latencyHistory = [];
    this.fpsHistory = [];
    this.maxHistory = 50;

    // Detection display cache & fadeout
    this.lastDetections = [];
    this.lastDetectionTs = 0;
    this.displayDurationMs = 2000;
    this.detectionFeed = [];
    this.rAfHandle = null;

    // Chart state
    this.chartCanvas = null;
    this.chartCtx = null;
    this.showChart = false;

    this.init();
  }

  async init() {
    this.setupDOM();
    this.setupCanvas();
    this.setupSocketEvents();
    await this.initWebRTC();
    await this.fetchOrRestoreRoom();

    if (this.detectOnDesktop) {
      await this.initDesktopDetector();
    }
  }

  // ── 1. DOM & Event Wiring ─────────────────────────────────────────
  setupDOM() {
    document.getElementById('benchmarkBtn')?.addEventListener('click', () => this.runBenchmark());
    document.getElementById('performanceBtn')?.addEventListener('click', () => this.togglePerformanceChart());
    document.getElementById('downloadBtn')?.addEventListener('click', () => this.downloadMetrics());
    document.getElementById('resetBtn')?.addEventListener('click', () => this.resetMetrics());

    // Pagehide / Visibility cleanup (N25)
    window.addEventListener('pagehide', () => this.dispose());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.rAfHandle) {
          cancelAnimationFrame(this.rAfHandle);
          this.rAfHandle = null;
        }
      } else if (this.remoteStream) {
        this.startRenderLoop();
      }
    });
  }

  // ── 2. Canvas & Sizing ────────────────────────────────────────────
  setupCanvas() {
    this.overlayCanvas = document.getElementById('overlayCanvas');
    if (this.overlayCanvas) {
      this.overlayCtx = this.overlayCanvas.getContext('2d');
    }

    const videoWrapper = document.getElementById('videoContainer');
    if (videoWrapper && window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(videoWrapper);
    }
  }

  resizeCanvas() {
    const video = document.getElementById('remoteVideo');
    if (!video || !this.overlayCanvas || !this.overlayCtx) return;

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── 3. WebRTC Setup & Perfect Negotiation ─────────────────────────
  async initWebRTC() {
    const iceConfig = await window.WebRTCUtils.fetchIceConfig();
    this.peerConnection = new RTCPeerConnection(iceConfig);

    // Desktop is the polite peer in Perfect Negotiation
    this.negotiator = new window.WebRTCUtils.PerfectNegotiator(
      this.peerConnection,
      this.socket,
      { isPolite: true }
    );

    this.peerConnection.ontrack = (event) => {
      console.log('📺 Received remote video track');
      this.remoteStream = event.streams[0];
      const video = document.getElementById('remoteVideo');
      const loader = document.getElementById('loadingIndicator');

      if (video) {
        video.srcObject = this.remoteStream;
        video.style.display = 'block';
        video.onloadedmetadata = () => {
          this.resizeCanvas();
          this.startRenderLoop();
          if (this.detectOnDesktop) {
            this.startDesktopDetection();
          }
        };
      }
      if (loader) loader.style.display = 'none';
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`WebRTC connection state: ${state}`);
      this.updateConnectionBadge(state);
    };
  }

  // ── 4. Room & QR Code Management with Session Persistence (N05, N11) ─
  async fetchOrRestoreRoom() {
    try {
      // Check for saved session in sessionStorage (N11)
      const savedSession = sessionStorage.getItem('webrtc_desktop_session');
      if (savedSession) {
        try {
          const parsed = JSON.parse(savedSession);
          if (parsed.roomCode && parsed.desktopToken) {
            this.roomCode = parsed.roomCode;
            this.desktopToken = parsed.desktopToken;
            this.csrfToken = parsed.csrfToken;

            // Render existing QR & room info
            this.renderRoomDetails(parsed);

            // Rejoin existing room
            this.socket.emit('join-room', {
              roomCode: this.roomCode,
              role: 'desktop',
              token: this.desktopToken
            }, (ack) => {
              if (ack && ack.success) {
                console.log('Reconnected to existing desktop room session.');
                return;
              }
              // Room expired, create new one
              this.createNewRoom();
            });
            return;
          }
        } catch {
          // Invalid session, create new
        }
      }

      await this.createNewRoom();
    } catch (err) {
      console.error('Failed to initialize room:', err);
      window.WebRTCUtils.showToast('Failed to initialize session room. Check server connection.', 'error');
    }
  }

  async createNewRoom() {
    const res = await fetch('/api/qr');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    this.roomCode = data.roomCode;
    this.desktopToken = data.desktopToken;
    this.csrfToken = data.csrfToken;

    // Save session in sessionStorage (N11)
    sessionStorage.setItem('webrtc_desktop_session', JSON.stringify({
      roomCode: this.roomCode,
      desktopToken: this.desktopToken,
      csrfToken: this.csrfToken,
      qr: data.qr,
      url: data.url
    }));

    this.renderRoomDetails(data);

    // Join room as desktop presenting desktopToken (N05)
    this.socket.emit('join-room', {
      roomCode: this.roomCode,
      role: 'desktop',
      token: this.desktopToken
    });
  }

  renderRoomDetails(data) {
    const qrEl = document.getElementById('qrCodeContainer');
    if (qrEl && data.qr) {
      qrEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = data.qr;
      img.alt = 'Scan with mobile camera to connect';
      qrEl.appendChild(img);
    }

    const roomEl = document.getElementById('roomCodeDisplay');
    if (roomEl) roomEl.textContent = data.roomCode || this.roomCode;

    const urlEl = document.getElementById('connectionUrl');
    if (urlEl) urlEl.textContent = data.url || '';
  }

  // ── 5. Socket Events ──────────────────────────────────────────────
  setupSocketEvents() {
    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
      if (this.roomCode && this.desktopToken) {
        // Idempotent rejoin on socket reconnection (F5, N09)
        this.socket.emit('join-room', {
          roomCode: this.roomCode,
          role: 'desktop',
          token: this.desktopToken
        });
      }
    });

    this.socket.on('connect_error', (err) => {
      console.warn('Socket connect error:', err);
      window.WebRTCUtils.showToast('Signaling server connection error. Reconnecting...', 'error');
      this.updateConnectionBadge('disconnected');
    });

    this.socket.on('peer-joined', (data) => {
      console.log(`📱 Mobile peer joined room: ${data.role}`);
      this.updateConnectionBadge('connecting');
      window.WebRTCUtils.showToast('Mobile camera connected!', 'success');
    });

    this.socket.on('peer-left', () => {
      console.log('📱 Mobile peer left');
      this.updateConnectionBadge('disconnected');
      window.WebRTCUtils.showToast('Mobile camera disconnected.', 'info');
    });

    this.socket.on('room-closed', (data) => {
      console.warn('Room closed by server:', data?.reason);
      sessionStorage.removeItem('webrtc_desktop_session');
      window.WebRTCUtils.showToast(data?.reason || 'Room closed. Refreshing session...', 'info');
      setTimeout(() => this.createNewRoom(), 1000);
    });

    // Relay of detection results from phone (Single-sided pipeline, N15)
    this.socket.on('detection-result', (result) => {
      if (!this.detectOnDesktop && result && Array.isArray(result.detections)) {
        this.handleDetectionFrame(result);
      }
    });

    this.socket.on('error-message', (err) => {
      console.warn('Server error message:', err.message || err.error);
      window.WebRTCUtils.showToast(err.message || err.error, 'error');
    });
  }

  // ── 6. Detection Processing & Rendering (N16 Canonical Metrics) ────
  handleDetectionFrame(result) {
    const now = Date.now();
    // Canonical E2E Latency: Current time minus phone capture timestamp (N16)
    const latency = Math.max(0, now - (result.capture_ts || now));

    // Single increment path (L25 fix)
    this.processedFrames++;
    this.fpsCounter++;

    this.lastDetections = result.detections || [];
    this.lastDetectionTs = now;

    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.maxHistory) {
      this.latencyHistory.shift();
    }

    this.updateMetricsUI(latency, this.lastDetections.length);
    this.updateDetectionFeed(this.lastDetections);
  }

  startRenderLoop() {
    if (this.rAfHandle) return;

    const render = () => {
      this.drawDetections();
      this.rAfHandle = requestAnimationFrame(render);
    };
    this.rAfHandle = requestAnimationFrame(render);
  }

  drawDetections() {
    if (!this.overlayCanvas || !this.overlayCtx) return;

    const video = document.getElementById('remoteVideo');
    const width = this.overlayCanvas.width / (window.devicePixelRatio || 1);
    const height = this.overlayCanvas.height / (window.devicePixelRatio || 1);

    this.overlayCtx.clearRect(0, 0, width, height);

    const now = Date.now();
    const elapsed = now - this.lastDetectionTs;

    if (elapsed > this.displayDurationMs || this.lastDetections.length === 0) {
      return;
    }

    // Letterbox compensation (N23/L42)
    const fitRect = window.WebRTCUtils.objectFitRect(
      width,
      height,
      video?.videoWidth || width,
      video?.videoHeight || height,
      'contain'
    );

    let alpha = 1.0;
    const fadeWindow = 500;
    if (elapsed > this.displayDurationMs - fadeWindow) {
      alpha = 1.0 - (elapsed - (this.displayDurationMs - fadeWindow)) / fadeWindow;
    }

    this.overlayCtx.globalAlpha = Math.max(0, Math.min(1, alpha));
    const palette = ['#51cf66', '#339af0', '#fcc419', '#ff6b6b', '#cc5de8', '#20c997', '#ff922b'];

    this.lastDetections.forEach((det, idx) => {
      const color = palette[idx % palette.length];
      const boxX = fitRect.x + det.xmin * fitRect.width;
      const boxY = fitRect.y + det.ymin * fitRect.height;
      const boxW = (det.xmax - det.xmin) * fitRect.width;
      const boxH = (det.ymax - det.ymin) * fitRect.height;

      // Bounding Box
      this.overlayCtx.strokeStyle = color;
      this.overlayCtx.lineWidth = 2.5;
      this.overlayCtx.strokeRect(boxX, boxY, boxW, boxH);

      // Corner brackets
      const cornerLen = Math.min(boxW, boxH) * 0.18;
      this.overlayCtx.lineWidth = 4;
      this.overlayCtx.beginPath();
      // Top Left
      this.overlayCtx.moveTo(boxX, boxY + cornerLen);
      this.overlayCtx.lineTo(boxX, boxY);
      this.overlayCtx.lineTo(boxX + cornerLen, boxY);
      // Top Right
      this.overlayCtx.moveTo(boxX + boxW - cornerLen, boxY);
      this.overlayCtx.lineTo(boxX + boxW);
      this.overlayCtx.lineTo(boxX + boxW, boxY + cornerLen);
      // Bottom Left
      this.overlayCtx.moveTo(boxX, boxY + boxH - cornerLen);
      this.overlayCtx.lineTo(boxX, boxY + boxH);
      this.overlayCtx.lineTo(boxX + cornerLen, boxY + boxH);
      // Bottom Right
      this.overlayCtx.moveTo(boxX + boxW - cornerLen, boxY + boxH);
      this.overlayCtx.lineTo(boxX + boxW, boxY + boxH);
      this.overlayCtx.lineTo(boxX + boxW, boxY + boxH - cornerLen);
      this.overlayCtx.stroke();

      // Label Tag
      const labelText = `${det.label} ${Math.round(det.score * 100)}%`;
      this.overlayCtx.font = '600 12px Inter, sans-serif';
      const textMetrics = this.overlayCtx.measureText(labelText);
      const tagH = 20;
      const tagW = textMetrics.width + 12;
      const tagY = boxY > tagH + 4 ? boxY - tagH - 3 : boxY + 3;

      this.overlayCtx.fillStyle = color;
      this.overlayCtx.beginPath();
      this.overlayCtx.roundRect ? this.overlayCtx.roundRect(boxX, tagY, tagW, tagH, 4) : this.overlayCtx.rect(boxX, tagY, tagW, tagH);
      this.overlayCtx.fill();

      this.overlayCtx.fillStyle = '#ffffff';
      this.overlayCtx.fillText(labelText, boxX + 6, tagY + 14);
    });

    this.overlayCtx.globalAlpha = 1.0;
  }

  // ── 7. Desktop Fallback Detection Loop (N21) ──────────────────────
  async initDesktopDetector() {
    const banner = document.getElementById('modelStatus');
    if (banner) {
      banner.style.display = 'block';
      banner.textContent = '🧠 Loading desktop AI model...';
    }

    const ready = await this.detector.loadModel((pct) => {
      if (banner) banner.textContent = `🧠 Loading AI model... ${pct}%`;
    });

    if (ready && banner) {
      banner.textContent = '✅ AI model ready (Desktop Mode)';
      setTimeout(() => { banner.style.display = 'none'; }, 2000);
    } else if (banner) {
      banner.innerHTML = '❌ Model failed to load. <button id="retryModelBtn" style="margin-left:8px;padding:2px 8px;cursor:pointer;">Retry</button>';
      document.getElementById('retryModelBtn')?.addEventListener('click', () => this.initDesktopDetector());
    }
  }

  startDesktopDetection() {
    if (this.desktopDetectionLoop) return;

    this.desktopDetectionLoop = setInterval(async () => {
      const video = document.getElementById('remoteVideo');
      if (video && video.readyState >= 2 && this.detector.modelLoaded) {
        const captureTs = Date.now();
        const detections = await this.detector.detect(video);
        const frame = {
          capture_ts: captureTs,
          inference_ts: Date.now(),
          detections
        };
        this.handleDetectionFrame(frame);
      }
    }, 150);
  }

  // ── 8. UI Updates & Live Metrics (N16) ─────────────────────────────
  updateMetricsUI(latency, objectCount) {
    const latEl = document.getElementById('latencyMetric');
    const objEl = document.getElementById('objectsMetric');
    const procEl = document.getElementById('processedMetric');

    if (latEl) latEl.textContent = `${latency}ms`;
    if (objEl) objEl.textContent = objectCount;
    if (procEl) procEl.textContent = this.processedFrames;

    const now = Date.now();
    if (now - this.lastFpsTimestamp >= 1000) {
      this.currentFps = this.fpsCounter;
      this.fpsCounter = 0;
      this.lastFpsTimestamp = now;

      const fpsEl = document.getElementById('fpsMetric');
      if (fpsEl) fpsEl.textContent = `${this.currentFps} fps`;

      this.fpsHistory.push(this.currentFps);
      if (this.fpsHistory.length > this.maxHistory) {
        this.fpsHistory.shift();
      }

      if (this.showChart) {
        this.renderChart();
      }
    }
  }

  updateDetectionFeed(detections) {
    if (!detections || detections.length === 0) return;
    const now = Date.now();

    detections.forEach((d) => {
      this.detectionFeed.unshift({
        label: d.label,
        score: d.score,
        ts: now
      });
    });

    this.detectionFeed = this.detectionFeed.slice(0, 10);
    const listEl = document.getElementById('detectionList');
    if (!listEl) return;

    listEl.innerHTML = '';
    this.detectionFeed.slice(0, 5).forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'detection-chip';
      chip.innerHTML = `<span>🏷️ ${item.label}</span><span>${Math.round(item.score * 100)}%</span>`;
      listEl.appendChild(chip);
    });
  }

  updateConnectionBadge(state) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;

    const map = {
      connected: ['status-connected', '📱 Phone Connected'],
      connecting: ['status-connecting', '📱 Connecting...'],
      disconnected: ['status-disconnected', '📱 Disconnected']
    };

    const [cls, text] = map[state] || map.disconnected;
    el.className = `status-pill ${cls}`;
    el.textContent = text;
  }

  // ── 9. Performance Chart ──────────────────────────────────────────
  togglePerformanceChart() {
    const container = document.getElementById('chartContainer');
    if (!container) return;

    this.showChart = !this.showChart;
    container.style.display = this.showChart ? 'block' : 'none';

    if (this.showChart && !this.chartCanvas) {
      this.chartCanvas = document.getElementById('latencyCanvas');
      if (this.chartCanvas) {
        this.chartCtx = this.chartCanvas.getContext('2d');
      }
    }

    if (this.showChart) this.renderChart();
  }

  renderChart() {
    if (!this.chartCtx || !this.chartCanvas) return;
    const ctx = this.chartCtx;
    const w = this.chartCanvas.width;
    const h = this.chartCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Latency Plot (Red)
    if (this.latencyHistory.length > 1) {
      const maxLat = Math.max(100, ...this.latencyHistory);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.latencyHistory.forEach((val, i) => {
        const x = (w * i) / (this.maxHistory - 1);
        const y = h - (val / maxLat) * (h - 10) - 5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // FPS Plot (Green)
    if (this.fpsHistory.length > 1) {
      const maxFps = Math.max(30, ...this.fpsHistory);
      ctx.strokeStyle = '#51cf66';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.fpsHistory.forEach((val, i) => {
        const x = (w * i) / (this.maxHistory - 1);
        const y = h - (val / maxFps) * (h - 10) - 5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Legend
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText('Latency (ms)', 8, 14);
    ctx.fillStyle = '#51cf66';
    ctx.fillText('FPS', 90, 14);
  }

  // ── 10. Benchmark & Metrics Actions (N40) ─────────────────────────
  async runBenchmark() {
    const btn = document.getElementById('benchmarkBtn');
    if (!btn) return;

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '⏱️ Running (30s)...';

    try {
      await this.resetMetrics();
      window.WebRTCUtils.showToast('Benchmark started for 30 seconds...', 'info');

      await new Promise((resolve) => setTimeout(resolve, 30_000));

      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      this.saveJsonFile(data, `benchmark-${Date.now()}.json`);
      window.WebRTCUtils.showToast(
        `Benchmark Complete! Median: ${data.median_latency_ms}ms, P95: ${data.p95_latency_ms}ms, FPS: ${data.processed_fps}`,
        'success',
        6000
      );
    } catch (err) {
      console.error('Benchmark failed:', err);
      window.WebRTCUtils.showToast('Benchmark failed to complete.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async resetMetrics() {
    try {
      const res = await fetch('/api/reset-metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken || ''
        }
      });
      if (res.ok) {
        this.processedFrames = 0;
        this.fpsCounter = 0;
        this.latencyHistory = [];
        this.fpsHistory = [];
        this.updateMetricsUI(0, 0);
        window.WebRTCUtils.showToast('Metrics reset successfully.', 'info');
      }
    } catch (err) {
      console.error('Failed to reset metrics:', err);
    }
  }

  async downloadMetrics() {
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.saveJsonFile(data, `metrics-${Date.now()}.json`);
    } catch (err) {
      console.error('Failed to export metrics:', err);
      window.WebRTCUtils.showToast('Failed to export metrics.', 'error');
    }
  }

  saveJsonFile(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 11. Cleanup Lifecycle ─────────────────────────────────────────
  dispose() {
    if (this.rAfHandle) cancelAnimationFrame(this.rAfHandle);
    if (this.desktopDetectionLoop) clearInterval(this.desktopDetectionLoop);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.detector) this.detector.dispose();
    if (this.negotiator) this.negotiator.dispose();
    if (this.peerConnection) this.peerConnection.close();
    if (this.socket) this.socket.disconnect();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.desktopApp = new DesktopApp();
});
