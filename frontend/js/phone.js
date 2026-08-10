/**
 * Phone Camera — WebRTC Object Detection
 *
 * Captures camera feed, streams to desktop via WebRTC,
 * runs COCO-SSD detection on-device, and sends detection results
 * to the desktop for overlay display.
 */
class PhoneCamera {
  constructor() {
    this.socket = io();
    this.peerConnection = null;
    this.localStream = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.currentCamera = 'environment'; // Default to back camera
    this.isHD = false;
    this.detector = window.objectDetector;
    this.roomCode = null;

    // Detection state
    this.isDetecting = false;
    this.detectionEnabled = true;
    this.detectionInterval = 300; // ms between detections

    // Metrics
    this.metrics = {
      fps: 0,
      lastLatency: 0,
      objectCount: 0,
      framesSent: 0,
      lastFpsUpdate: Date.now(),
    };

    this.recentDetections = [];

    this.init();
  }

  async init() {
    this.setupCanvas();
    this.setupWebRTC();
    this.setupSocketEvents();
    this.extractRoomCode();
    this.updateMetricsDisplay();

    // Load AI model
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

  // ── Room Code ──

  extractRoomCode() {
    const params = new URLSearchParams(window.location.search);
    this.roomCode = params.get('room');

    if (this.roomCode) {
      this.socket.emit('join-room', {
        roomCode: this.roomCode,
        role: 'phone',
      });
      console.log(`📱 Joining room: ${this.roomCode}`);
    } else {
      console.warn('⚠️ No room code in URL. Connection may not pair correctly.');
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
      el.textContent = `🧠 Loading AI... ${progress}%`;
    }
  }

  hideModelLoadingUI() {
    const el = document.getElementById('modelStatus');
    if (el) {
      el.textContent = '✅ AI ready';
      setTimeout(() => {
        el.style.display = 'none';
      }, 2000);
    }
  }

  showModelError() {
    const el = document.getElementById('modelStatus');
    if (el) {
      el.textContent = '❌ Model load failed';
      el.style.background = 'rgba(255,71,87,0.6)';
    }
  }

  // ── Canvas ──

  setupCanvas() {
    this.overlayCanvas = document.getElementById('overlayCanvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
  }

  resizeCanvas() {
    const video = document.getElementById('localVideo');
    const rect = video.getBoundingClientRect();

    this.overlayCanvas.style.width = rect.width + 'px';
    this.overlayCanvas.style.height = rect.height + 'px';

    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    this.socket.on('answer', async (answer) => {
      console.log('✅ Received answer');
      try {
        await this.peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch (error) {
        console.error('Error setting remote description:', error);
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

    this.socket.on('peer-joined', (data) => {
      console.log(`🖥️ Desktop joined the room`);
    });

    this.socket.on('peer-left', () => {
      console.log(`🖥️ Desktop left the room`);
      this.updateConnectionStatus('disconnected');
    });
  }

  // ── Camera ──

  async startCamera() {
    const startBtn = document.getElementById('startButton');
    const spinner = document.getElementById('loadingSpinner');
    const errorEl = document.getElementById('errorMessage');

    if (startBtn) startBtn.style.display = 'none';
    if (spinner) spinner.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';

    try {
      const constraints = this.getCameraConstraints();
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      this.setupLocalVideo();
      await this.startWebRTCConnection();
      this.showCameraView();
      this.startDetectionLoop();
    } catch (error) {
      console.error('❌ Camera access failed:', error);
      this.showError(this.getCameraErrorMessage(error));
      if (startBtn) startBtn.style.display = 'block';
      if (spinner) spinner.style.display = 'none';
    }
  }

  getCameraConstraints() {
    const constraints = {
      video: {
        facingMode: this.currentCamera,
        aspectRatio: { ideal: 16 / 9 },
      },
      audio: false,
    };

    if (this.isHD) {
      constraints.video.width = { ideal: 1280 };
      constraints.video.height = { ideal: 720 };
    } else {
      constraints.video.width = { ideal: 640 };
      constraints.video.height = { ideal: 480 };
    }

    return constraints;
  }

  setupLocalVideo() {
    const video = document.getElementById('localVideo');
    video.srcObject = this.localStream;

    video.onloadedmetadata = () => this.resizeCanvas();
    video.onresize = () => this.resizeCanvas();
  }

  async startWebRTCConnection() {
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    this.socket.emit('offer', offer);
  }

  // ── Detection Loop ──

  startDetectionLoop() {
    const runDetection = async () => {
      if (this.isDetecting || !this.detectionEnabled) return;
      this.isDetecting = true;

      try {
        const video = document.getElementById('localVideo');
        if (
          video &&
          video.readyState >= 2 &&
          this.detector.modelLoaded
        ) {
          const captureTs = Date.now();
          const detections = await this.detector.detect(video);
          const inferenceTs = Date.now();

          // Draw on phone overlay
          this.drawDetections(detections);

          // Update local UI
          this.updateRecentDetections(detections);
          this.metrics.lastLatency = inferenceTs - captureTs;
          this.metrics.objectCount = detections.length;

          // Send results to desktop via server
          this.socket.emit('detection-result', {
            frame_id: `phone_${Date.now()}`,
            capture_ts: captureTs,
            inference_ts: inferenceTs,
            detections,
          });

          // Count frames
          this.socket.emit('frame-count');
          this.metrics.framesSent++;
        }
      } catch (error) {
        console.error('Detection error:', error);
      } finally {
        this.isDetecting = false;
      }
    };

    setInterval(runDetection, this.detectionInterval);
  }

  // ── Drawing ──

  drawDetections(detections) {
    this.overlayCtx.clearRect(
      0,
      0,
      this.overlayCanvas.width,
      this.overlayCanvas.height
    );

    const rect = this.overlayCanvas.getBoundingClientRect();

    const colors = [
      '#51cf66', '#339af0', '#fcc419', '#ff6b6b',
      '#cc5de8', '#20c997', '#ff922b', '#845ef7',
    ];

    detections.forEach((det, i) => {
      const color = colors[i % colors.length];
      let x = det.xmin * rect.width;
      let y = det.ymin * rect.height;
      let w = (det.xmax - det.xmin) * rect.width;
      let h = (det.ymax - det.ymin) * rect.height;

      // Mirror for front camera
      if (this.currentCamera === 'user') {
        x = rect.width - x - w;
      }

      // Bounding box
      this.overlayCtx.strokeStyle = color;
      this.overlayCtx.lineWidth = 3;
      this.overlayCtx.strokeRect(x, y, w, h);

      // Label
      const label = `${det.label} ${Math.round(det.score * 100)}%`;
      this.overlayCtx.font = 'bold 14px Inter, Arial, sans-serif';
      const tm = this.overlayCtx.measureText(label);

      this.overlayCtx.fillStyle = color;
      this.overlayCtx.fillRect(x, y - 26, tm.width + 12, 22);

      this.overlayCtx.fillStyle = '#fff';
      this.overlayCtx.fillText(label, x + 6, y - 9);
    });
  }

  // ── UI Updates ──

  updateRecentDetections(detections) {
    const el = document.getElementById('recentDetections');
    if (!el) return;

    if (detections.length > 0) {
      const timestamp = new Date().toLocaleTimeString();
      detections.forEach((d) => {
        this.recentDetections.unshift({
          label: d.label,
          score: d.score,
          timestamp,
        });
      });
      this.recentDetections = this.recentDetections.slice(0, 5);
    }

    // Safe DOM update (no innerHTML)
    el.textContent = '';

    if (this.recentDetections.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color: #999; font-size: 0.7rem;';
      empty.textContent = '🔍 Looking for objects...';
      el.appendChild(empty);
    } else {
      this.recentDetections.forEach((d) => {
        const item = document.createElement('div');
        item.className = 'detection-item';
        item.textContent = `✅ ${d.label} (${Math.round(d.score * 100)}%)`;
        el.appendChild(item);
      });
    }
  }

  updateConnectionStatus(state) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;

    el.textContent = '';
    const dot = document.createElement('div');
    dot.className = 'status-dot';
    const span = document.createElement('span');

    switch (state) {
      case 'connected':
        el.className = 'status-indicator status-connected';
        span.textContent = 'Connected';
        break;
      case 'connecting':
        el.className = 'status-indicator status-connecting';
        span.textContent = 'Connecting...';
        break;
      default:
        el.className = 'status-indicator';
        span.textContent = 'Disconnected';
    }

    el.appendChild(dot);
    el.appendChild(span);
  }

  showCameraView() {
    const perm = document.getElementById('permissionScreen');
    const video = document.getElementById('videoContainer');
    const controls = document.getElementById('controlsPanel');
    if (perm) perm.style.display = 'none';
    if (video) video.style.display = 'block';
    if (controls) controls.style.display = 'flex';
  }

  showError(message) {
    const el = document.getElementById('errorMessage');
    if (el) {
      el.textContent = message;
      el.style.display = 'block';
    }
  }

  getCameraErrorMessage(error) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Camera permission denied. Please allow camera access and refresh.';
      case 'NotFoundError':
        return 'No camera found on this device.';
      case 'NotSupportedError':
        return 'Camera not supported. Ensure you are using HTTPS.';
      case 'SecurityError':
        return 'Camera blocked by security policy. Use HTTPS.';
      default:
        return `Camera error: ${error.message}`;
    }
  }

  updateMetricsDisplay() {
    setInterval(() => {
      const fpsEl = document.getElementById('fpsDisplay');
      const latEl = document.getElementById('latencyDisplay');
      const objEl = document.getElementById('objectCountDisplay');

      if (fpsEl) fpsEl.textContent = this.metrics.fps;
      if (latEl) latEl.textContent = `${this.metrics.lastLatency}ms`;
      if (objEl) objEl.textContent = this.metrics.objectCount;

      // FPS calculation
      const now = Date.now();
      if (now - this.metrics.lastFpsUpdate >= 1000) {
        this.metrics.fps = this.metrics.framesSent;
        this.metrics.framesSent = 0;
        this.metrics.lastFpsUpdate = now;
      }
    }, 500);
  }
}

// ── Global Functions ──

async function switchCamera() {
  if (!window.phoneCamera) return;

  window.phoneCamera.currentCamera =
    window.phoneCamera.currentCamera === 'user' ? 'environment' : 'user';

  if (window.phoneCamera.localStream) {
    window.phoneCamera.localStream.getTracks().forEach((t) => t.stop());
  }

  try {
    const constraints = window.phoneCamera.getCameraConstraints();
    window.phoneCamera.localStream =
      await navigator.mediaDevices.getUserMedia(constraints);

    window.phoneCamera.setupLocalVideo();

    const sender = window.phoneCamera.peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');

    if (sender) {
      await sender.replaceTrack(
        window.phoneCamera.localStream.getVideoTracks()[0]
      );
    }
  } catch (error) {
    console.error('Camera switch failed:', error);
  }
}

function toggleQuality() {
  if (!window.phoneCamera) return;
  window.phoneCamera.isHD = !window.phoneCamera.isHD;
  const btn = document.getElementById('qualityToggle');
  if (btn) btn.textContent = window.phoneCamera.isHD ? '📺 SD' : '📺 HD';
  switchCamera().then(() => switchCamera());
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function startCamera() {
  if (window.phoneCamera) {
    window.phoneCamera.startCamera();
  }
}

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  window.phoneCamera = new PhoneCamera();
});
