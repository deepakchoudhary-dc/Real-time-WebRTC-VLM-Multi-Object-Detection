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
      } catch (err) {
        // Candidate discarded if invalid
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
      } catch (err) {
        // Discard failed queued candidates
      }
    }
  }

  clear() {
    this.queue = [];
    this.hasRemoteDescription = false;
  }
}

/**
 * MDN Perfect Negotiation Coordinator with Offer Retry & Single-Owner ICE Restart (R03, N18, N19)
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
        } catch (err) {
          // Restart failed
        }
      }
    };

    // 4. Incoming Offer from peer
    this.socket.on('offer', async (description) => {
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
      } catch (err) {
        // Error handling incoming offer
      }
    });

    // 5. Incoming Answer from peer
    this.socket.on('answer', async (description) => {
      try {
        this.clearOfferRetry();
        this.isSettingRemoteAnswerPending = true;
        await this.pc.setRemoteDescription(new RTCSessionDescription(description));
        this.isSettingRemoteAnswerPending = false;
        await this.candidateQueue.flush();
      } catch (err) {
        this.isSettingRemoteAnswerPending = false;
      }
    });

    // 6. Incoming ICE candidate from peer
    this.socket.on('ice-candidate', async (candidateInit) => {
      await this.candidateQueue.addCandidate(candidateInit);
    });
  }

  async sendOffer(options = {}) {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer(options);
      if (this.pc.signalingState !== 'stable') return;
      await this.pc.setLocalDescription(offer);
      this.socket.emit('offer', this.pc.localDescription);

      // Start offer retry timer with backoff (N18)
      this.scheduleOfferRetry();
    } catch (err) {
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
    // Fallback to default STUN
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
  IceCandidateQueue,
  PerfectNegotiator,
  fetchIceConfig,
  showToast
};
