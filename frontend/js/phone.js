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

    this.roomCode = null;
    this.roomToken = null;

    this.facingMode = 'environment'; // Default back camera
    this.isHD = false;

    // AI Detector
    this.detector = new window.ObjectDetector();
    this.detectionInterval = 180; // ms (~5.5 FPS mobile inference)
    this.detectionTimer = null;
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
    this.parseRoomCredentials();
    this.setupSocketEvents();
    await this.initDetector();
  }

  // ── 1. Parse Credentials from QR Code URL ─────────────────────────
  parseRoomCredentials() {
    const params = new URLSearchParams(window.location.search);
    this.roomCode = params.get('room');
    this.roomToken = params.get('token');

    if (!this.roomCode) {
      this.showError('No room code provided. Please scan the QR code from the desktop.');
    }
  }

  // ── 2. DOM & Controls ─────────────────────────────────────────────
  setupDOM() {
    document.getElementById('startBtn')?.addEventListener('click', () => this.startCamera());
    document.getElementById('flipBtn')?.addEventListener('click', () => this.toggleCamera());
    document.getElementById('qualityBtn')?.addEventListener('click', () => this.toggleQuality());

    this.overlayCanvas = document.getElementById('overlayCanvas');
    if (this.overlayCanvas) {
      this.overlayCtx = this.overlayCanvas.getContext('2d');
    }

    // Lifecycle cleanups (L47)
    window.addEventListener('pagehide', () => this.dispose());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.stopDetectionLoop();
      } else if (this.localStream) {
        this.startDetectionLoop();
      }
    });
  }

  // ── 3. Detector Initialization ────────────────────────────────────
  async initDetector() {
    await this.detector.loadModel();
  }

  // ── 4. WebRTC Setup ───────────────────────────────────────────────
  async initWebRTC() {
    const iceConfig = await window.WebRTCUtils.fetchIceConfig();
    this.peerConnection = new RTCPeerConnection(iceConfig);

    // Phone is the impolite peer in Perfect Negotiation (impolite = makes offers)
    this.negotiator = new window.WebRTCUtils.PerfectNegotiator(
      this.peerConnection,
      this.socket,
      { isPolite: false }
    );

    // Attach local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`PeerConnection state: ${state}`);
      this.updateStatusBadge(state);
    };
  }

  // ── 5. Socket Events & Room Join ──────────────────────────────────
  setupSocketEvents() {
    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
      if (this.roomCode && this.roomToken) {
        this.socket.emit('join-room', {
          roomCode: this.roomCode,
          role: 'phone',
          token: this.roomToken
        });
      }
    });

    this.socket.on('room-joined', (data) => {
      console.log('Successfully joined room:', data);
      this.updateStatusBadge(data.hasPeer ? 'connected' : 'connecting');
    });

    this.socket.on('peer-joined', () => {
      console.log('🖥️ Desktop peer joined room');
      this.updateStatusBadge('connected');
    });

    this.socket.on('peer-left', () => {
      console.log('🖥️ Desktop peer left');
      this.updateStatusBadge('disconnected');
    });

    this.socket.on('error-message', (err) => {
      console.error('Room join rejected:', err);
      this.showError(err.error || err.message || 'Access denied.');
    });
  }

  // ── 6. Camera Initialization & Video Flow ─────────────────────────
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
      video.srcObject = this.localStream;
      video.onloadedmetadata = () => {
        this.resizeCanvas();
        this.startDetectionLoop();
      };

      await this.initWebRTC();

      if (permOverlay) permOverlay.style.display = 'none';
      if (videoWrapper) videoWrapper.style.display = 'block';
      if (controlsPanel) controlsPanel.style.display = 'flex';

      this.updateMetricsDisplayLoop();
    } catch (err) {
      console.error('Camera access failed:', err);
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

  // ── 7. Flip Camera & Quality Switch ───────────────────────────────
  async toggleCamera() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';

    const videoEl = document.getElementById('localVideo');
    if (videoEl) {
      if (this.facingMode === 'user') {
        videoEl.classList.add('mirrored');
      } else {
        videoEl.classList.remove('mirrored');
      }
    }

    if (!this.localStream) return;

    // Stop old tracks
    this.localStream.getTracks().forEach((t) => t.stop());

    try {
      const constraints = this.getConstraints();
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      const video = document.getElementById('localVideo');
      video.srcObject = this.localStream;

      // Replace WebRTC sender track seamlessly (F10 fix)
      const newVideoTrack = this.localStream.getVideoTracks()[0];
      const sender = this.peerConnection
        ?.getSenders()
        .find((s) => s.track && s.track.kind === 'video');

      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);
      }
    } catch (err) {
      console.error('Failed to toggle camera:', err);
    }
  }

  async toggleQuality() {
    this.isHD = !this.isHD;
    const btn = document.getElementById('qualityBtn');
    if (btn) {
      btn.textContent = this.isHD ? '📺 SD' : '📺 HD';
      btn.classList.toggle('active', this.isHD);
    }

    const videoTrack = this.localStream?.getVideoTracks()[0];
    if (videoTrack && videoTrack.applyConstraints) {
      // Use applyConstraints directly to avoid camera restarts (L35 fix)
      try {
        await videoTrack.applyConstraints({
          width: { ideal: this.isHD ? 1280 : 640 },
          height: { ideal: this.isHD ? 720 : 480 }
        });
      } catch (err) {
        console.warn('applyConstraints failed, renegotiating:', err);
      }
    }
  }

  // ── 8. Canvas Sizing & Drawing ────────────────────────────────────
  resizeCanvas() {
    const video = document.getElementById('localVideo');
    if (!video || !this.overlayCanvas) return;

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── 9. Detection Loop ─────────────────────────────────────────────
  startDetectionLoop() {
    if (this.detectionTimer) return;

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

          // Draw bounding boxes locally on phone screen
          this.drawPhoneOverlays(detections);

          // Relay detections to desktop via server
          this.socket.emit('detection-result', {
            frame_id: `frame_${captureTs}`,
            capture_ts: captureTs,
            inference_ts: inferenceTs,
            detections
          });
        }
      } catch (err) {
        console.error('Detection frame error:', err);
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

      // Handle front-camera mirroring (F12 fix)
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

  // ── 10. Metrics HUD Loop ──────────────────────────────────────────
  updateMetricsDisplayLoop() {
    setInterval(() => {
      const now = Date.now();
      if (now - this.lastFpsTs >= 1000) {
        this.currentFps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsTs = now;

        const fpsEl = document.getElementById('fpsDisplay');
        const latEl = document.getElementById('latencyDisplay');
        const objEl = document.getElementById('objectsDisplay');

        if (fpsEl) fpsEl.textContent = `${this.currentFps} fps`;
        if (latEl) latEl.textContent = `${this.lastLatency}ms`;
        if (objEl) objEl.textContent = this.activeObjects;
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

  // ── 11. Cleanup Lifecycle ─────────────────────────────────────────
  dispose() {
    this.stopDetectionLoop();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.negotiator) this.negotiator.dispose();
    if (this.peerConnection) this.peerConnection.close();
    if (this.socket) this.socket.disconnect();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.phoneCameraApp = new PhoneCameraApp();
});
