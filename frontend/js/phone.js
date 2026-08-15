/**
 * Phone Client — WebRTC Wireless Camera & AI Vision Node
 * 
 * Streams mobile camera via WebRTC, runs on-device inference with WebGL GPU,
 * and relays detected bounding boxes to the desktop hub.
 */
'use strict';

class PhoneCameraApp {
  constructor() {
    this.socket = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.peerConnection = null;
    this.negotiator = null;
    this.localStream = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.resizeObserver = null;

    this.roomCode = null;
    this.phoneToken = null;

    this.facingMode = 'environment'; // Default back camera
    this.isHD = false;

    // Detection mode: if detect=desktop is set, mobile skips local AI inference (N21, R15)
    const urlParams = new URLSearchParams(window.location.search);
    this.disablePhoneInference = urlParams.get('detect') === 'desktop';

    // AI Detector
    this.detector = new window.ObjectDetector();
    this.detectionInterval = 180; // ms (~5.5 FPS mobile inference)
    this.detectionTimer = null;
    this.metricsTimer = null;
    this.isDetecting = false;

    // Metrics
    this.frameCount = 0;
    this.lastFpsTs = Date.now();
    this.currentFps = 0;
    this.lastLatency = 0;
    this.activeObjects = 0;

    this.init();
  }

  async init() {
    this.setupDOM();
    this.setupCanvas();
    this.parseRoomCredentials();
    this.setupSocketEvents();
    
    if (!this.disablePhoneInference) {
      await this.initDetector();
    }
  }

  // ── 1. Parse Credentials from QR Code URL (N05) ───────────────────
  parseRoomCredentials() {
    const params = new URLSearchParams(window.location.search);
    this.roomCode = params.get('room');
    this.phoneToken = params.get('token');

    if (!this.roomCode || !this.phoneToken) {
      this.showError('Authentication token or room code missing. Please re-scan QR code from desktop.');
    }
  }

  // ── 2. DOM & Controls ─────────────────────────────────────────────
  setupDOM() {
    document.getElementById('startBtn')?.addEventListener('click', () => this.startCamera());
    document.getElementById('flipBtn')?.addEventListener('click', () => this.toggleCamera());
    document.getElementById('qualityBtn')?.addEventListener('click', () => this.toggleQuality());

    // Lifecycle cleanups & bfcache restoration (R04, N24, N25)
    window.addEventListener('pagehide', () => this.dispose());
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        if (this.roomCode && this.phoneToken) {
          this.socket.emit('join-room', {
            roomCode: this.roomCode,
            role: 'phone',
            token: this.phoneToken
          });
        }
        if (!this.localStream) {
          this.startCamera();
        }
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.stopDetectionLoop();
      } else if (this.localStream && !this.disablePhoneInference) {
        this.startDetectionLoop();
      }
    });
  }

  // ── 3. Canvas & ResizeObserver (N23) ──────────────────────────────
  setupCanvas() {
    this.overlayCanvas = document.getElementById('overlayCanvas');
    if (this.overlayCanvas) {
      this.overlayCtx = this.overlayCanvas.getContext('2d');
    }

    const videoWrapper = document.getElementById('videoWrapper');
    if (videoWrapper && window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(videoWrapper);
    }
  }

  resizeCanvas() {
    const video = document.getElementById('localVideo');
    if (!video || !this.overlayCanvas || !this.overlayCtx) return;

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── 4. Detector Initialization with Retry UX (N20) ────────────────
  async initDetector() {
    const loaded = await this.detector.loadModel();
    if (!loaded) {
      this.showModelError();
    }
  }

  showModelError() {
    const card = document.getElementById('errorCard');
    if (!card) return;

    card.innerHTML = '';
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Failed to load AI model. ';

    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry Model';
    retryBtn.style.cssText = 'margin-left:8px;padding:2px 8px;cursor:pointer;border-radius:4px;border:none;background:#ff6b6b;color:#fff;font-weight:600;';
    retryBtn.addEventListener('click', async () => {
      card.style.display = 'none';
      await this.initDetector();
    });

    card.appendChild(textSpan);
    card.appendChild(retryBtn);
    card.style.display = 'block';
  }

  // ── 5. WebRTC Setup (R03 Single Owner) ────────────────────────────
  async initWebRTC() {
    if (this.negotiator) this.negotiator.dispose();
    if (this.peerConnection) this.peerConnection.close();

    const iceConfig = await window.WebRTCUtils.fetchIceConfig();
    this.peerConnection = new RTCPeerConnection(iceConfig);

    // Phone is the impolite peer in Perfect Negotiation
    this.negotiator = new window.WebRTCUtils.PerfectNegotiator(
      this.peerConnection,
      this.socket,
      {
        isPolite: false,
        onStateChange: (state) => this.updateStatusBadge(state) // Single owner (R03)
      }
    );

    // Attach local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }
  }

  // ── 6. Socket Events & Room Join (N05) ────────────────────────────
  setupSocketEvents() {
    this.socket.on('connect', () => {
      if (this.roomCode && this.phoneToken) {
        this.socket.emit('join-room', {
          roomCode: this.roomCode,
          role: 'phone',
          token: this.phoneToken
        });
      }
    });

    this.socket.on('connect_error', () => {
      this.updateStatusBadge('disconnected');
    });

    this.socket.on('room-joined', (data) => {
      this.updateStatusBadge(data.hasPeer ? 'connected' : 'connecting');
    });

    this.socket.on('peer-joined', () => {
      this.updateStatusBadge('connected');
    });

    this.socket.on('peer-left', () => {
      this.updateStatusBadge('disconnected');
    });

    this.socket.on('room-closed', (data) => {
      this.showError(data?.reason || 'Session expired. Please scan a fresh QR code from the desktop.');
      this.dispose();
    });

    this.socket.on('error-message', (err) => {
      this.showError(err.error || err.message || 'Access denied.');
    });
  }

  // ── 7. Camera Initialization & Video Flow ─────────────────────────
  async startCamera() {
    const permOverlay = document.getElementById('permOverlay');
    const videoWrapper = document.getElementById('videoWrapper');
    const controlsPanel = document.getElementById('controlsPanel');
    const startBtn = document.getElementById('startBtn');

    if (startBtn) startBtn.disabled = true;

    try {
      const constraints = this.getConstraints();
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      const video = document.getElementById('localVideo');
      if (video) {
        video.srcObject = this.localStream;
        video.onloadedmetadata = () => {
          this.resizeCanvas();
          if (!this.disablePhoneInference) {
            this.startDetectionLoop();
          }
        };
      }

      await this.initWebRTC();

      if (permOverlay) permOverlay.style.display = 'none';
      if (videoWrapper) videoWrapper.style.display = 'block';
      if (controlsPanel) controlsPanel.style.display = 'flex';

      this.startMetricsLoop();
    } catch (err) {
      this.showError(this.formatCameraError(err));
      if (startBtn) startBtn.disabled = false;
    }
  }

  getConstraints() {
    return {
      audio: false,
      video: {
        facingMode: this.facingMode,
        width: { ideal: this.isHD ? 1280 : 640 },
        height: { ideal: this.isHD ? 720 : 480 }
      }
    };
  }

  formatCameraError(err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'Camera permission was denied. Please allow camera access in browser settings.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'No camera found on this device.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'Camera is already in use by another application.';
    }
    return `Camera Error: ${err.message || 'Unable to open camera.'}`;
  }

  showError(msg) {
    const el = document.getElementById('errorCard');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  // ── 8. Flip Camera with Safe Track Transition (G14, R15) ─────────
  async toggleCamera() {
    const targetFacing = this.facingMode === 'user' ? 'environment' : 'user';
    const constraints = {
      audio: false,
      video: {
        facingMode: targetFacing,
        width: { ideal: this.isHD ? 1280 : 640 },
        height: { ideal: this.isHD ? 720 : 480 }
      }
    };

    try {
      // 1. Acquire new stream FIRST before stopping previous tracks (G14)
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);

      // 2. Stop old stream tracks cleanly
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
      }

      this.facingMode = targetFacing;
      this.localStream = newStream;

      const videoEl = document.getElementById('localVideo');
      if (videoEl) {
        videoEl.srcObject = this.localStream;
        if (this.facingMode === 'user') {
          videoEl.classList.add('mirrored');
        } else {
          videoEl.classList.remove('mirrored');
        }
      }

      const flipBtn = document.getElementById('flipBtn');
      if (flipBtn) {
        flipBtn.setAttribute('aria-pressed', this.facingMode === 'user' ? 'true' : 'false');
      }

      const newVideoTrack = this.localStream.getVideoTracks()[0];
      const sender = this.peerConnection
        ?.getSenders()
        .find((s) => s.track && s.track.kind === 'video');

      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);
      }
    } catch (err) {
      // Safe fallback: keep existing stream intact (G14)
      this.showError(`Failed to switch camera: ${err.message || 'Camera unavailable'}`);
    }
  }

  async toggleQuality() {
    this.isHD = !this.isHD;
    const btn = document.getElementById('qualityBtn');
    if (btn) {
      btn.textContent = this.isHD ? '📺 SD' : '📺 HD';
      btn.classList.toggle('active', this.isHD);
      btn.setAttribute('aria-pressed', this.isHD ? 'true' : 'false');
    }

    const videoTrack = this.localStream?.getVideoTracks()[0];
    if (videoTrack && videoTrack.applyConstraints) {
      try {
        await videoTrack.applyConstraints({
          width: { ideal: this.isHD ? 1280 : 640 },
          height: { ideal: this.isHD ? 720 : 480 }
        });
      } catch {
        // Constraints fallback
      }
    }
  }

  // ── 9. Detection Loop (Single-sided Mobile Inference, N21) ────────
  startDetectionLoop() {
    if (this.detectionTimer || this.disablePhoneInference) return;

    this.detectionTimer = setInterval(async () => {
      if (this.isDetecting) return;
      this.isDetecting = true;

      try {
        const video = document.getElementById('localVideo');
        if (video && video.readyState >= 2 && this.detector.modelLoaded) {
          const captureTs = Date.now();
          const detections = await this.detector.detect(video);
          const inferenceTs = Date.now();

          this.lastLatency = inferenceTs - captureTs;
          this.activeObjects = detections.length;
          this.frameCount++;

          this.drawPhoneOverlays(detections);

          this.socket.emit('detection-result', {
            frame_id: `frame_${captureTs}`,
            capture_ts: captureTs,
            inference_ts: inferenceTs,
            detections
          });
        }
      } catch {
        // Frame detection error
      } finally {
        this.isDetecting = false;
      }
    }, this.detectionInterval);
  }

  stopDetectionLoop() {
    if (this.detectionTimer) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }
  }

  drawPhoneOverlays(detections) {
    if (!this.overlayCtx || !this.overlayCanvas) return;

    const width = this.overlayCanvas.width / (window.devicePixelRatio || 1);
    const height = this.overlayCanvas.height / (window.devicePixelRatio || 1);
    const video = document.getElementById('localVideo');

    this.overlayCtx.clearRect(0, 0, width, height);
    if (!detections || detections.length === 0) return;

    const fitRect = window.WebRTCUtils.objectFitRect(
      width,
      height,
      video?.videoWidth || width,
      video?.videoHeight || height,
      'cover'
    );

    const palette = ['#51cf66', '#339af0', '#fcc419', '#ff6b6b', '#cc5de8'];

    detections.forEach((det, idx) => {
      const color = palette[idx % palette.length];
      let boxX = fitRect.x + det.xmin * fitRect.width;
      const boxY = fitRect.y + det.ymin * fitRect.height;
      const boxW = (det.xmax - det.xmin) * fitRect.width;
      const boxH = (det.ymax - det.ymin) * fitRect.height;

      if (this.facingMode === 'user') {
        boxX = width - (boxX + boxW);
      }

      this.overlayCtx.strokeStyle = color;
      this.overlayCtx.lineWidth = 2.5;
      this.overlayCtx.strokeRect(boxX, boxY, boxW, boxH);

      const label = `${det.label} ${Math.round(det.score * 100)}%`;
      this.overlayCtx.font = '700 11px Inter, sans-serif';
      const textMetrics = this.overlayCtx.measureText(label);
      const tagH = 18;
      const tagW = textMetrics.width + 10;
      const tagY = boxY > tagH + 2 ? boxY - tagH - 2 : boxY + 2;

      this.overlayCtx.fillStyle = color;
      this.overlayCtx.fillRect(boxX, tagY, tagW, tagH);

      this.overlayCtx.fillStyle = '#fff';
      this.overlayCtx.fillText(label, boxX + 5, tagY + 13);
    });
  }

  // ── 10. Metrics HUD Loop (R15 Accuracy in Desktop Mode) ───────────
  startMetricsLoop() {
    if (this.metricsTimer) clearInterval(this.metricsTimer);

    this.metricsTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastFpsTs >= 1000) {
        this.currentFps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsTs = now;

        const fpsEl = document.getElementById('fpsDisplay');
        const latEl = document.getElementById('latencyDisplay');
        const objEl = document.getElementById('objectsDisplay');

        if (this.disablePhoneInference) {
          if (fpsEl) fpsEl.textContent = 'Desktop AI';
          if (latEl) latEl.textContent = 'Offloaded';
          if (objEl) objEl.textContent = '—';
        } else {
          if (fpsEl) fpsEl.textContent = `${this.currentFps} fps`;
          if (latEl) latEl.textContent = `${this.lastLatency}ms`;
          if (objEl) objEl.textContent = this.activeObjects;
        }
      }
    }, 500);
  }

  updateStatusBadge(state) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    if (!dot || !text) return;

    dot.className = 'dot';
    if (state === 'connected') {
      dot.classList.add('dot-connected');
      text.textContent = 'Streaming';
    } else if (state === 'connecting') {
      dot.classList.add('dot-connecting');
      text.textContent = 'Connecting...';
    } else {
      text.textContent = 'Disconnected';
    }
  }

  // ── 11. Cleanup Lifecycle (N24, N25) ──────────────────────────────
  dispose() {
    this.stopDetectionLoop();
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.detector) {
      this.detector.dispose();
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.negotiator) this.negotiator.dispose();
    if (this.peerConnection) this.peerConnection.close();
    if (this.socket) this.socket.disconnect();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.phoneCameraApp = new PhoneCameraApp();
});
