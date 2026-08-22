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
  } catch (error) {
    console.warn('[WebRTCUtils] ICE config fetch failed, using STUN fallback:', error?.message);
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

/**
 * Adaptive Inference Scheduling (plan.md Phase 1 — "Fixed Inference Intervals")
 *
 * Replaces fixed setInterval loops: measures real inference duration each frame
 * and self-schedules the next run so slow devices automatically back off and
 * fast devices run at the target cadence without queueing overlapping frames.
 */
class AdaptiveInferenceScheduler {
  /**
   * @param {function} task - async task to execute per tick
   * @param {object} options
   * @param {number} options.targetInterval - desired ms between frame STARTS
   * @param {number} [options.minInterval] - lower bound for adaptive back-off
   * @param {number} [options.maxInterval] - upper bound for adaptive back-off
   */
  constructor(task, options = {}) {
    if (typeof task !== 'function') {
      throw new TypeError('AdaptiveInferenceScheduler requires an async task function.');
    }
    this.task = task;
    this.baseTargetInterval = Math.max(10, options.targetInterval || 150);
    this.targetInterval = this.baseTargetInterval;
    this.minInterval = Math.max(0, options.minInterval ?? Math.floor(this.baseTargetInterval / 2));
    this.maxInterval = Math.max(this.targetInterval, options.maxInterval ?? 1000);
    this.running = false;
    this.isExecuting = false; // Re-entrancy guard (R09)
    this.avgDurationMs = 0; // Exponential moving average of inference duration
    this._timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._schedule(0);
  }

  stop() {
    this.running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedule(delayMs) {
    if (!this.running) return;
    this._timer = setTimeout(() => this._tick(), delayMs);
  }

  async _tick() {
    if (!this.running || this.isExecuting) return;

    const start = performance.now();
    this.isExecuting = true;
    try {
      await this.task();
    } catch (error) {
      console.warn('[AdaptiveInferenceScheduler] task failed:', error?.message || error);
    } finally {
      this.isExecuting = false;

      if (this.running) {
        const duration = performance.now() - start;
        this.avgDurationMs =
          this.avgDurationMs === 0 ? duration : this.avgDurationMs * 0.8 + duration * 0.2;

        // Adaptive back-off: if inference is consistently eating the whole
        // budget, relax the target so the main thread can breathe.
        if (this.avgDurationMs > this.targetInterval * 0.9) {
          this.targetInterval = Math.min(
            this.maxInterval,
            Math.ceil(this.targetInterval * 1.25)
          );
        } else if (
          this.avgDurationMs < this.targetInterval * 0.35 &&
          this.targetInterval > this.baseTargetInterval
        ) {
          this.targetInterval = Math.max(
            this.baseTargetInterval,
            Math.floor(this.targetInterval * 0.85)
          );
        }

        // plan.md formula: delay = max(0, targetInterval - duration)
        const delay = Math.max(this.minInterval, this.targetInterval - duration);
        this._schedule(delay);
      }
    }
  }
}

/**
 * WebRTC Stats Collection & Adaptive Bitrate Control (plan.md Phase 1 —
 * "No WebRTC Stats Collection").
 *
 * Polls RTCPeerConnection.getStats() for bandwidth, packet loss and RTT,
 * exposes a live snapshot via onStats, and optionally clamps the outbound
 * video encoder maxBitrate up/down based on measured packet loss.
 */
class AdaptiveBitrateController {
  constructor(peerConnection, options = {}) {
    this.pc = peerConnection;
    this.intervalMs = options.intervalMs || 1000;
    this.onStats = typeof options.onStats === 'function' ? options.onStats : null;
    this.initialMaxBitrate = options.initialMaxBitrate || 1_500_000;
    this.minBitrate = options.minBitrate || 150_000;
    this.maxBitrateCeiling = options.maxBitrateCeiling || 2_500_000;

    this.sender = null;
    this.currentMaxBitrate = this.initialMaxBitrate;
    this.statsInterval = null;
    this.polling = false;

    // Live network snapshot (single-source truth for consumers)
    this.snapshot = {
      rttMs: null,
      packetsLost: 0,
      lossPct: 0,
      bitrateKbps: 0,
      framesPerSecond: null,
      quality: 'unknown' // good | degraded | poor | unknown
    };

    this._lastBytes = null;
    this._lastTimestampUs = null;
    this._lastLostTotal = null;
    this._lastReceivedTotal = null;
  }

  /** Attach the outbound video sender whose encoding should be rate-limited. */
  attachSender(sender) {
    if (sender && typeof sender.getParameters === 'function') {
      this.sender = sender;
    }
  }

  startMonitoring() {
    this.stopMonitoring();
    this.statsInterval = setInterval(async () => {
      if (this.polling) return; // Never overlap getStats rounds
      this.polling = true;
      try {
        await this.pollOnce();
      } catch {
        // getStats can reject during ICE restarts/transient states — ignore round
      } finally {
        this.polling = false;
      }
    }, this.intervalMs);
  }

  stopMonitoring() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  async pollOnce() {
    if (!this.pc || typeof this.pc.getStats !== 'function') return;
    const report = await this.pc.getStats();

    let inboundVideo = null;
    let candidatePairRttS = null;

    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        inboundVideo = s;
      } else if (
        s.type === 'candidate-pair' &&
        s.state === 'succeeded' &&
        typeof s.currentRoundTripTime === 'number'
      ) {
        candidatePairRttS = s.currentRoundTripTime;
      }
    });

    this._processReport(inboundVideo, candidatePairRttS);
    await this._adaptSenderBitrate();
    this.snapshot.currentMaxBitrateKbps = Math.round(this.currentMaxBitrate / 1000);

    if (this.onStats) {
      try {
        this.onStats({ ...this.snapshot });
      } catch (error) {
        console.warn('[AdaptiveBitrateController] onStats callback failed:', error?.message);
      }
    }
  }

  _processReport(inboundVideo, rttSeconds) {
    // ── Bitrate (delta bytes / delta time) ──
    if (inboundVideo && typeof inboundVideo.bytesReceived === 'number') {
      const nowUs =
        inboundVideo.timestamp ||
        (typeof performance !== 'undefined' ? performance.now() * 1000 : Date.now() * 1000);
      if (this._lastBytes !== null && nowUs > this._lastTimestampUs) {
        const bitsDelta = (inboundVideo.bytesReceived - this._lastBytes) * 8;
        const seconds = (nowUs - this._lastTimestampUs) / 1_000_000;
        this.snapshot.bitrateKbps = Math.max(0, Math.round(bitsDelta / seconds / 1000));
      }
      this._lastBytes = inboundVideo.bytesReceived;
      this._lastTimestampUs = nowUs;
    }

    // ── Packet loss % (delta-based so it reflects recent conditions) ──
    if (inboundVideo) {
      const lost = inboundVideo.packetsLost || 0;
      const received = inboundVideo.packetsReceived || 0;
      if (this._lastLostTotal !== null) {
        const dLost = Math.max(0, lost - this._lastLostTotal);
        const dRecv = Math.max(0, received - this._lastReceivedTotal);
        const total = dLost + dRecv;
        this.snapshot.lossPct = total > 0 ? (dLost / total) * 100 : 0;
        this.snapshot.quality = this._classifyQuality();
      }
      this._lastLostTotal = lost;
      this._lastReceivedTotal = received;
      this.snapshot.packetsLost = lost;
    }

    // ── RTT & decode FPS ──
    if (rttSeconds !== null) {
      this.snapshot.rttMs = Math.round(rttSeconds * 1000);
    }
    if (inboundVideo && typeof inboundVideo.framesPerSecond === 'number') {
      this.snapshot.framesPerSecond = inboundVideo.framesPerSecond;
    }
  }

  _classifyQuality() {
    const loss = this.snapshot.lossPct;
    const rtt = this.snapshot.rttMs;
    if (loss > 8 || (rtt !== null && rtt > 400)) return 'poor';
    if (loss > 2 || (rtt !== null && rtt > 200)) return 'degraded';
    return 'good';
  }

  async _adaptSenderBitrate() {
    if (!this.sender) return;

    const prev = this.currentMaxBitrate;
    if (this.snapshot.lossPct > 8) {
      // Aggressive downshift under sustained loss
      this.currentMaxBitrate = Math.max(
        this.minBitrate,
        Math.floor(this.currentMaxBitrate * 0.7)
      );
    } else if (this.snapshot.lossPct > 2) {
      // Gentle downshift
      this.currentMaxBitrate = Math.max(
        this.minBitrate,
        Math.floor(this.currentMaxBitrate * 0.9)
      );
    } else {
      // Slow recovery when the network is healthy
      this.currentMaxBitrate = Math.min(
        this.maxBitrateCeiling,
        this.currentMaxBitrate + 100_000
      );
    }

    if (this.currentMaxBitrate === prev) return;

    try {
      const params = this.sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = this.currentMaxBitrate;
      params.degradationPreference = 'maintain-framerate';
      await this.sender.setParameters(params);
    } catch (error) {
      // Some browsers reject setParameters mid-negotiation; keep snapshot honest
      this.currentMaxBitrate = prev;
      console.warn('[AdaptiveBitrateController] setParameters rejected:', error?.message);
    }
  }

  dispose() {
    this.stopMonitoring();
    this.sender = null;
    this.onStats = null;
  }
}

// Global namespace
window.WebRTCUtils = {
  objectFitRect,
  getCameraConstraints,
  drawBoundingBoxes,
  IceCandidateQueue,
  PerfectNegotiator,
  AdaptiveInferenceScheduler,
  AdaptiveBitrateController,
  fetchIceConfig,
  showToast
};
