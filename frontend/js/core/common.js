/**
 * Shared Core Utilities for WebRTC Object Detection (Desktop & Phone)
 */
'use strict';

/**
 * Calculates the bounding rectangle of a video rendered inside a container with object-fit.
 * Ensures bounding boxes map directly to video pixels regardless of aspect ratio or orientation.
 */
function objectFitRect(containerWidth, containerHeight, videoWidth, videoHeight, fitMode = 'contain') {
  if (!videoWidth || !videoHeight || !containerWidth || !containerHeight) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }

  const containerRatio = containerWidth / containerHeight;
  const videoRatio = videoWidth / videoHeight;

  let renderWidth = containerWidth;
  let renderHeight = containerHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (fitMode === 'contain') {
    if (containerRatio > videoRatio) {
      renderWidth = containerHeight * videoRatio;
      offsetX = (containerWidth - renderWidth) / 2;
    } else {
      renderHeight = containerWidth / videoRatio;
      offsetY = (containerHeight - renderHeight) / 2;
    }
  } else if (fitMode === 'cover') {
    if (containerRatio > videoRatio) {
      renderHeight = containerWidth / videoRatio;
      offsetY = (containerHeight - renderHeight) / 2;
    } else {
      renderWidth = containerHeight * videoRatio;
      offsetX = (containerWidth - renderWidth) / 2;
    }
  }

  return {
    x: offsetX,
    y: offsetY,
    width: renderWidth,
    height: renderHeight
  };
}

/**
 * Standard camera constraints builder (H8 deduplication)
 */
function getCameraConstraints(facingMode = 'environment', isHD = false) {
  return {
    audio: false,
    video: {
      facingMode,
      width: { ideal: isHD ? 1280 : 640 },
      height: { ideal: isHD ? 720 : 480 }
    }
  };
}

/**
 * Shared canvas bounding box & label tag renderer (H8 deduplication)
 */
function drawBoundingBoxes(ctx, canvas, video, detections, options = {}) {
  if (!ctx || !canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const fitMode = options.fitMode || 'contain';
  const isMirrored = !!options.isMirrored;
  const alpha = typeof options.alpha === 'number' ? options.alpha : 1.0;

  ctx.clearRect(0, 0, width, height);
  if (!detections || detections.length === 0) return;

  const fitRect = objectFitRect(
    width,
    height,
    video?.videoWidth || width,
    video?.videoHeight || height,
    fitMode
  );

  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const palette = ['#51cf66', '#339af0', '#fcc419', '#ff6b6b', '#cc5de8', '#20c997', '#ff922b'];

  detections.forEach((det, idx) => {
    const color = palette[idx % palette.length];
    let boxX = fitRect.x + det.xmin * fitRect.width;
    const boxY = fitRect.y + det.ymin * fitRect.height;
    const boxW = (det.xmax - det.xmin) * fitRect.width;
    const boxH = (det.ymax - det.ymin) * fitRect.height;

    if (isMirrored) {
      boxX = width - (boxX + boxW);
    }

    // Bounding Box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Corner brackets
    const cornerLen = Math.min(boxW, boxH) * 0.18;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(boxX, boxY + cornerLen);
    ctx.lineTo(boxX, boxY);
    ctx.lineTo(boxX + cornerLen, boxY);
    ctx.moveTo(boxX + boxW - cornerLen, boxY);
    ctx.lineTo(boxX + boxW);
    ctx.lineTo(boxX + boxW, boxY + cornerLen);
    ctx.moveTo(boxX, boxY + boxH - cornerLen);
    ctx.lineTo(boxX, boxY + boxH);
    ctx.lineTo(boxX + cornerLen, boxY + boxH);
    ctx.moveTo(boxX + boxW - cornerLen, boxY + boxH);
    ctx.lineTo(boxX + boxW);
    ctx.lineTo(boxX + boxW, boxY + boxH - cornerLen);
    ctx.stroke();

    // Label Tag
    const labelText = `${det.label} ${Math.round(det.score * 100)}%`;
    ctx.font = '600 12px Inter, sans-serif';
    const textMetrics = ctx.measureText(labelText);
    const tagH = 20;
    const tagW = textMetrics.width + 12;
    const tagY = boxY > tagH + 4 ? boxY - tagH - 3 : boxY + 3;

    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(boxX, tagY, tagW, tagH, 4);
    } else {
      ctx.rect(boxX, tagY, tagW, tagH);
    }
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, boxX + 6, tagY + 14);
  });

  ctx.globalAlpha = 1.0;
}

/**
 * Buffer ICE candidates that arrive before setRemoteDescription has completed (F2)
 */
class IceCandidateQueue {
  constructor(peerConnection) {
    this.pc = peerConnection;
    this.queue = [];
    this.hasRemoteDescription = false;
  }

  async addCandidate(candidateInit) {
    if (!candidateInit) return;

    if (this.hasRemoteDescription && this.pc.remoteDescription) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch {
        // Discard candidate on error
      }
    } else {
      this.queue.push(candidateInit);
    }
  }

  async flush() {
    this.hasRemoteDescription = true;
    while (this.queue.length > 0) {
      const candidateInit = this.queue.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch {
        // Discard failed candidate
      }
    }
  }

  clear() {
    this.queue = [];
    this.hasRemoteDescription = false;
  }
}

/**
 * MDN Perfect Negotiation Coordinator with Offer Retry & Socket Handler Cleanup (G04, R03, N18, N19)
 */
class PerfectNegotiator {
  constructor(peerConnection, socket, options = {}) {
    this.pc = peerConnection;
    this.socket = socket;
    this.isPolite = !!options.isPolite; // Desktop = polite (true), Phone = impolite (false)
    this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.candidateQueue = new IceCandidateQueue(this.pc);

    // Offer retry backoff (N18)
    this.offerRetryTimer = null;
    this.offerRetryCount = 0;
    this.maxOfferRetries = 5;

    // Bound listeners for clean disposal (G04)
    this.offerHandler = this.handleOffer.bind(this);
    this.answerHandler = this.handleAnswer.bind(this);
    this.iceHandler = this.handleIceCandidate.bind(this);

    this.setupListeners();
  }

  setupListeners() {
    // 1. Negotiation Needed (automatic offer creation)
    this.pc.onnegotiationneeded = async () => {
      await this.sendOffer();
    };

    // 2. ICE Candidate generation
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', event.candidate);
      }
    };

    // 3. Single-Owner Connection State Change & Automatic ICE Restart Recovery (R03, N19)
    this.pc.onconnectionstatechange = async () => {
      const state = this.pc.connectionState;
      if (this.onStateChange) {
        this.onStateChange(state);
      }

      if (state === 'failed') {
        try {
          if (this.pc.restartIce) {
            this.pc.restartIce();
          } else {
            await this.sendOffer({ iceRestart: true });
          }
        } catch {
          // Restart failed
        }
      }
    };

    // 4. Socket Listeners (G04)
    this.socket.on('offer', this.offerHandler);
    this.socket.on('answer', this.answerHandler);
    this.socket.on('ice-candidate', this.iceHandler);
  }

  async handleOffer(description) {
    try {
      const readyForOffer =
        !this.makingOffer &&
        (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
      const offerCollision = !readyForOffer;

      this.ignoreOffer = !this.isPolite && offerCollision;
      if (this.ignoreOffer) {
        return;
      }

      if (offerCollision) {
        await this.pc.setLocalDescription({ type: 'rollback' });
      }

      await this.pc.setRemoteDescription(new RTCSessionDescription(description));
      await this.candidateQueue.flush();

      if (description.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.socket.emit('answer', this.pc.localDescription);
      }
    } catch {
      // Error handling offer
    }
  }

  async handleAnswer(description) {
    try {
      this.clearOfferRetry();
      this.isSettingRemoteAnswerPending = true;
      await this.pc.setRemoteDescription(new RTCSessionDescription(description));
      this.isSettingRemoteAnswerPending = false;
      await this.candidateQueue.flush();
    } catch {
      this.isSettingRemoteAnswerPending = false;
    }
  }

  async handleIceCandidate(candidateInit) {
    await this.candidateQueue.addCandidate(candidateInit);
  }

  async sendOffer(options = {}) {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer(options);
      if (this.pc.signalingState !== 'stable') return;
      await this.pc.setLocalDescription(offer);
      this.socket.emit('offer', this.pc.localDescription);

      this.scheduleOfferRetry();
    } catch {
      // Offer creation error
    } finally {
      this.makingOffer = false;
    }
  }

  scheduleOfferRetry() {
    this.clearOfferRetry();
    if (this.offerRetryCount >= this.maxOfferRetries) return;

    const delayMs = Math.min(10000, 2000 * Math.pow(1.5, this.offerRetryCount));
    this.offerRetryTimer = setTimeout(async () => {
      if (this.pc.signalingState === 'have-local-offer') {
        this.offerRetryCount++;
        this.socket.emit('offer', this.pc.localDescription);
        this.scheduleOfferRetry();
      }
    }, delayMs);
  }

  clearOfferRetry() {
    if (this.offerRetryTimer) {
      clearTimeout(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }
    this.offerRetryCount = 0;
  }

  dispose() {
    this.clearOfferRetry();
    this.candidateQueue.clear();

    // Clean up socket listeners to prevent handler stacking (G04)
    this.socket.off('offer', this.offerHandler);
    this.socket.off('answer', this.answerHandler);
    this.socket.off('ice-candidate', this.iceHandler);
  }
}

/**
 * Fetch ICE configuration (STUN/TURN) from server
 */
async function fetchIceConfig() {
  try {
    const res = await fetch('/api/ice-config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return { iceServers: data.iceServers };
    }
  } catch {
    // Default STUN fallback
  }

  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
}

/**
 * Show a floating UI toast notification
 */
function showToast(message, type = 'info', durationMs = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.setAttribute('aria-live', 'polite');
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 500;
    color: #fff;
    background: ${type === 'error' ? 'rgba(255, 71, 87, 0.95)' : type === 'success' ? 'rgba(81, 207, 102, 0.95)' : 'rgba(51, 154, 240, 0.95)'};
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    transition: opacity 0.3s ease, transform 0.3s ease;
    opacity: 0;
    transform: translateY(10px);
    pointer-events: auto;
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

// Global namespace
window.WebRTCUtils = {
  objectFitRect,
  getCameraConstraints,
  drawBoundingBoxes,
  IceCandidateQueue,
  PerfectNegotiator,
  fetchIceConfig,
  showToast
};
