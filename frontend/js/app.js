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

    // AI Detector (optional desktop fallback detection, N21, G03, H3)
    this.detector = new window.ObjectDetector();
    this.detectOnDesktop = sessionStorage.getItem('webrtc_detect_mode') === 'desktop';
    this.desktopDetectionInterval = 150; // ms base target (~6.7 FPS desktop inference)
    this.benchmarkAborted = false; // Cancellable benchmark (G16)

    // WebRTC stats collection & adaptive bitrate (plan.md Phase 1)
    this.bitrateController = null;
    this._lastNetWarnTs = 0;

    // Adaptive inference scheduling (plan.md Phase 1 — replaces fixed setInterval)
    this.desktopDetectionScheduler = new window.WebRTCUtils.AdaptiveInferenceScheduler(
      () => this.runDesktopDetectionFrame(),
      { targetInterval: this.desktopDetectionInterval, maxInterval: 1000 }
    );

    // Metrics state (Single-source truth)
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

    // Detection Mode Toggle (Propagates live to mobile peer and persists, G03, H3)
    const modeToggle = document.getElementById('detectModeToggle');
    if (modeToggle) {
      modeToggle.checked = this.detectOnDesktop;
      modeToggle.addEventListener('change', async (e) => {
        this.detectOnDesktop = e.target.checked;
        sessionStorage.setItem('webrtc_detect_mode', this.detectOnDesktop ? 'desktop' : 'mobile');

        // Propagate mode to connected phone in real time (H3)
        this.socket.emit('detect-mode', { mode: this.detectOnDesktop ? 'desktop' : 'mobile' });

        if (this.detectOnDesktop) {
          await this.initDesktopDetector();
          if (this.remoteStream) this.startDesktopDetection();
        } else {
          this.stopDesktopDetection();
        }

        window.WebRTCUtils.showToast(
          `AI Inference Mode: ${this.detectOnDesktop ? 'Desktop Hub' : 'Mobile Camera'}`,
          'info'
        );
      });
    }

    // Pagehide / Pageshow Lifecycle with Full Re-init (G05, H2, H10, R04, N25)
    window.addEventListener('pagehide', () => this.dispose());
    window.addEventListener('pageshow', async (event) => {
      this.benchmarkAborted = false; // Reset aborted flag on restore (H10)
      if (event.persisted) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        if (!this.peerConnection || this.peerConnection.connectionState === 'closed') {
          await this.initWebRTC();
        }
        if (this.detectOnDesktop && !this.detector.modelLoaded) {
          await this.initDesktopDetector(); // Re-init desktop detector on restore (H2)
        }
        await this.fetchOrRestoreRoom();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.rAfHandle) {
          cancelAnimationFrame(this.rAfHandle);
          this.rAfHandle = null;
        }
        this.stopDesktopDetection(); // Pause detection on hidden (R09)
      } else {
        if (this.remoteStream) {
          this.startRenderLoop();
          if (this.detectOnDesktop) this.startDesktopDetection();
        }
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

  // ── 3. WebRTC Setup & Perfect Negotiation (R03 Single Owner) ─────
  async initWebRTC() {
    if (this.negotiator) this.negotiator.dispose();
    if (this.peerConnection) this.peerConnection.close();

    const iceConfig = await window.WebRTCUtils.fetchIceConfig();
    this.peerConnection = new RTCPeerConnection(iceConfig);

    // Desktop is the polite peer in Perfect Negotiation
    this.negotiator = new window.WebRTCUtils.PerfectNegotiator(
      this.peerConnection,
      this.socket,
      {
        isPolite: true,
        onStateChange: (state) => this.updateConnectionBadge(state) // Single owner (R03)
      }
    );

    this.peerConnection.ontrack = (event) => {
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

    // WebRTC stats collection & network quality visibility (plan.md Phase 1)
    if (this.bitrateController) this.bitrateController.dispose();
    this.bitrateController = new window.WebRTCUtils.AdaptiveBitrateController(
      this.peerConnection,
      {
        intervalMs: 1000,
        onStats: (stats) => this.onNetworkStats(stats)
      }
    );
    this.bitrateController.startMonitoring();
  }

  /**
   * Inbound stream health from getStats polling (plan.md Phase 1).
   * Surfaces sustained degradation as a throttled toast so users get
   * visibility into bandwidth/packet-loss problems.
   */
  onNetworkStats(stats) {
    if (
      (stats.quality === 'poor' || stats.quality === 'degraded') &&
      Date.now() - this._lastNetWarnTs > 30_000
    ) {
      this._lastNetWarnTs = Date.now();
      window.WebRTCUtils.showToast(
        `Network degraded — ${Math.round(stats.lossPct)}% packet loss, ` +
          `${stats.bitrateKbps} kbps, RTT ${stats.rttMs ?? '?'}ms`,
        'info'
      );
    }
  }

  // ── 4. Room & QR Code with Session Persistence & Rejoin Backoff (N05, N11, R08, H11) ─
  async fetchOrRestoreRoom() {
    try {
      const savedSession = sessionStorage.getItem('webrtc_desktop_session');
      if (savedSession) {
        try {
          const parsed = JSON.parse(savedSession);
          if (parsed.roomCode && parsed.desktopToken) {
            this.roomCode = parsed.roomCode;
            this.desktopToken = parsed.desktopToken;
            this.csrfToken = parsed.csrfToken;

            this.renderRoomDetails(parsed);
            await this.attemptRejoinWithBackoff(parsed.roomCode, parsed.desktopToken);
            return;
          }
        } catch {
          // Bad session
        }
      }

      await this.createNewRoom();
    } catch {
      window.WebRTCUtils.showToast('Failed to initialize session room. Check server connection.', 'error');
    }
  }

  async attemptRejoinWithBackoff(roomCode, desktopToken, attempt = 1) {
    this.socket.emit('join-room', {
      roomCode,
      role: 'desktop',
      token: desktopToken
    }, (ack) => {
      if (ack && ack.success) {
        return;
      }

      // Rejoin backoff retry (R08)
      if (attempt <= 4 && ack && /occupied/i.test(ack.error || '')) {
        setTimeout(() => {
          this.attemptRejoinWithBackoff(roomCode, desktopToken, attempt + 1);
        }, 500 * attempt);
      } else {
        this.createNewRoom();
      }
    });
  }

  async createNewRoom() {
    try {
      const detectQuery = this.detectOnDesktop ? '?detect=desktop' : '';
      const res = await fetch(`/api/qr${detectQuery}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      this.roomCode = data.roomCode;
      this.desktopToken = data.desktopToken;
      this.csrfToken = data.csrfToken;

      sessionStorage.setItem('webrtc_desktop_session', JSON.stringify({
        roomCode: this.roomCode,
        desktopToken: this.desktopToken,
        csrfToken: this.csrfToken,
        qr: data.qr
      }));

      this.renderRoomDetails(data);

      this.socket.emit('join-room', {
        roomCode: this.roomCode,
        role: 'desktop',
        token: this.desktopToken
      });
    } catch {
      window.WebRTCUtils.showToast('Failed to create new room.', 'error');
    }
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
  }

  // ── 5. Socket Events ──────────────────────────────────────────────
  setupSocketEvents() {
    this.socket.on('connect', () => {
      if (this.roomCode && this.desktopToken) {
        this.socket.emit('join-room', {
          roomCode: this.roomCode,
          role: 'desktop',
          token: this.desktopToken
        });
      }
    });

    this.socket.on('connect_error', () => {
      window.WebRTCUtils.showToast('Signaling server connection error. Reconnecting...', 'error');
      this.updateConnectionBadge('disconnected');
    });

    this.socket.on('peer-joined', () => {
      this.updateConnectionBadge('connecting');
      // Synchronize current mode to newly connected peer (H3)
      this.socket.emit('detect-mode', { mode: this.detectOnDesktop ? 'desktop' : 'mobile' });
      window.WebRTCUtils.showToast('Mobile camera connected!', 'success');
    });

    this.socket.on('peer-left', () => {
      this.updateConnectionBadge('disconnected');
      this.lastDetections = [];
      if (this.overlayCtx && this.overlayCanvas) {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      }
      window.WebRTCUtils.showToast('Mobile camera disconnected.', 'info');
    });

    this.socket.on('room-closed', (data) => {
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
      window.WebRTCUtils.showToast(err.message || err.error, 'error');
    });
  }

  // ── 6. Detection Processing & Live Metrics (R01, R02, N16, H8) ─────
  handleDetectionFrame(result) {
    const now = Date.now();
    const latency = Math.max(0, now - (result.capture_ts || now));

    // Report live latency measurement back to server for /api/metrics (R02)
    this.socket.emit('metrics-report', { latency });

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

    const now = Date.now();
    const elapsed = now - this.lastDetectionTs;

    if (elapsed > this.displayDurationMs || this.lastDetections.length === 0) {
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      return;
    }

    const video = document.getElementById('remoteVideo');
    let alpha = 1.0;
    const fadeWindow = 500;
    if (elapsed > this.displayDurationMs - fadeWindow) {
      alpha = 1.0 - (elapsed - (this.displayDurationMs - fadeWindow)) / fadeWindow;
    }

    // Shared renderer (H8)
    window.WebRTCUtils.drawBoundingBoxes(
      this.overlayCtx,
      this.overlayCanvas,
      video,
      this.lastDetections,
      {
        alpha,
        fitMode: 'contain'
      }
    );
  }

  // ── 7. Desktop Fallback Detection Loop (N21, R09, G15, G17) ─────────
  // Adaptive inference scheduling (plan.md Phase 1): measures real inference
  // duration per frame and self-schedules instead of a fixed setInterval.
  async initDesktopDetector() {
    const banner = document.getElementById('modelStatus');
    if (banner) {
      banner.style.display = 'block';
      banner.textContent = 'Loading desktop AI model...';
    }

    const ready = await this.detector.loadModel((pct) => {
      if (banner) banner.textContent = `Loading AI model... ${pct}%`;
    });

    if (ready && banner) {
      banner.textContent = 'AI model ready (Desktop Mode)';
      setTimeout(() => { banner.style.display = 'none'; }, 2000);
    } else if (banner) {
      banner.textContent = 'Model failed to load.';
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.style.cssText = 'margin-left:8px;padding:2px 8px;cursor:pointer;';
      retryBtn.addEventListener('click', () => this.initDesktopDetector());
      banner.appendChild(retryBtn);
    }
  }

  startDesktopDetection() {
    // Safe to start anytime: runDesktopDetectionFrame guards on video readiness
    // and model state every tick (preserves pre-load start semantics).
    this.desktopDetectionScheduler.start();
  }

  stopDesktopDetection() {
    this.desktopDetectionScheduler.stop();
  }

  async runDesktopDetectionFrame() {
    const video = document.getElementById('remoteVideo');
    if (!video || video.readyState < 2 || !this.detector.modelLoaded) {
      return;
    }

    const captureTs = Date.now();
    const detections = await this.detector.detect(video);
    const frame = {
      capture_ts: captureTs,
      detections
    };
    this.handleDetectionFrame(frame);
  }

  // ── 8. UI Updates & Safe Text Content Feed (R01) ───────────────────
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
        label: String(d.label || '').substring(0, 32),
        score: d.score,
        ts: now
      });
    });

    this.detectionFeed = this.detectionFeed.slice(0, 10);
    const listEl = document.getElementById('detectionList');
    if (!listEl) return;

    listEl.innerHTML = '';
    // Safe textContent-only DOM construction (R01 fix)
    this.detectionFeed.slice(0, 5).forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'detection-chip';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = item.label;

      const scoreSpan = document.createElement('span');
      scoreSpan.textContent = `${Math.round(item.score * 100)}%`;

      chip.appendChild(labelSpan);
      chip.appendChild(scoreSpan);
      listEl.appendChild(chip);
    });
  }

  updateConnectionBadge(state) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;

    const map = {
      connected: ['status-connected', 'Phone Connected'],
      connecting: ['status-connecting', 'Connecting...'],
      disconnected: ['status-disconnected', 'Disconnected']
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

  // ── 10. Benchmark & Metrics Actions (G02, H5, G16, N40) ────────────
  async runBenchmark() {
    const btn = document.getElementById('benchmarkBtn');
    if (!btn) return;

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Running (30s)...';
    this.benchmarkAborted = false;

    try {
      await this.resetMetrics();
      window.WebRTCUtils.showToast('Benchmark started for 30 seconds...', 'info');

      await new Promise((resolve) => setTimeout(resolve, 30_000));

      if (this.benchmarkAborted) return;

      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      this.saveJsonFile(data, `benchmark-${Date.now()}.json`);
      window.WebRTCUtils.showToast(
        `Benchmark Complete! Median: ${data.median_latency_ms}ms, P95: ${data.p95_latency_ms}ms, FPS: ${data.processed_fps}`,
        'success',
        6000
      );
    } catch {
      window.WebRTCUtils.showToast('Benchmark failed to complete.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async resetMetrics(isRetry = false) {
    try {
      const res = await fetch('/api/reset-metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          this.csrfToken = data.csrfToken;
        }

        this.processedFrames = 0;
        this.fpsCounter = 0;
        this.latencyHistory = [];
        this.fpsHistory = [];
        this.updateMetricsUI(0, 0);
        window.WebRTCUtils.showToast('Metrics reset successfully.', 'info');
      } else if (res.status === 403 && !isRetry) {
        // Auto-recover from CSRF expiration by refreshing token once (H5)
        const qrRes = await fetch('/api/qr');
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          this.csrfToken = qrData.csrfToken;
          await this.resetMetrics(true);
        }
      }
    } catch {
      // Ignore reset failure
    }
  }

  async downloadMetrics() {
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.saveJsonFile(data, `metrics-${Date.now()}.json`);
    } catch {
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
    this.benchmarkAborted = true;
    if (this.rAfHandle) cancelAnimationFrame(this.rAfHandle);
    this.stopDesktopDetection();
    if (this.bitrateController) this.bitrateController.dispose();
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
