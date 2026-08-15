/**
 * Shared Core Utilities for WebRTC Object Detection (Desktop & Phone)
 */

/**
 * Calculates the bounding rectangle of a video rendered inside a container with object-fit (contain or cover).
 * This ensures bounding boxes perfectly map to the video pixels even when letterboxed or pillarboxed.
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
      // Container is wider -> Pillarbox (bars on left/right)
      renderWidth = containerHeight * videoRatio;
      offsetX = (containerWidth - renderWidth) / 2;
    } else {
      // Container is taller -> Letterbox (bars on top/bottom)
      renderHeight = containerWidth / videoRatio;
      offsetY = (containerHeight - renderHeight) / 2;
    }
  } else if (fitMode === 'cover') {
    if (containerRatio > videoRatio) {
      // Crop top/bottom
      renderHeight = containerWidth / videoRatio;
      offsetY = (containerHeight - renderHeight) / 2;
    } else {
      // Crop left/right
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
 * Buffer ICE candidates that arrive before setRemoteDescription has been called
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
        console.warn('Failed to add immediate ICE candidate:', err);
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
        console.warn('Failed to add queued ICE candidate:', err);
      }
    }
  }

  clear() {
    this.queue = [];
    this.hasRemoteDescription = false;
  }
}

/**
 * MDN Perfect Negotiation Coordinator
 * Handles glare, renegotiations, and polite/impolite peer roles
 */
class PerfectNegotiator {
  constructor(peerConnection, socket, options = {}) {
    this.pc = peerConnection;
    this.socket = socket;
    this.isPolite = !!options.isPolite; // Desktop = polite (true), Phone = impolite (false)
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.candidateQueue = new IceCandidateQueue(this.pc);

    this.setupListeners();
  }

  setupListeners() {
    // 1. Negotiation Needed (automatic offer creation)
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== 'stable') return;
        await this.pc.setLocalDescription(offer);
        this.socket.emit('offer', this.pc.localDescription);
      } catch (err) {
        console.error('Error in onnegotiationneeded:', err);
      } finally {
        this.makingOffer = false;
      }
    };

    // 2. ICE Candidate generation
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', event.candidate);
      }
    };

    // 3. Incoming Offer from peer
    this.socket.on('offer', async (description) => {
      try {
        const readyForOffer =
          !this.makingOffer &&
          (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
        const offerCollision = !readyForOffer;

        this.ignoreOffer = !this.isPolite && offerCollision;
        if (this.ignoreOffer) {
          console.warn('Impolite peer ignored colliding offer');
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
        console.error('Error handling incoming offer:', err);
      }
    });

    // 4. Incoming Answer from peer
    this.socket.on('answer', async (description) => {
      try {
        this.isSettingRemoteAnswerPending = true;
        await this.pc.setRemoteDescription(new RTCSessionDescription(description));
        this.isSettingRemoteAnswerPending = false;
        await this.candidateQueue.flush();
      } catch (err) {
        this.isSettingRemoteAnswerPending = false;
        console.error('Error handling incoming answer:', err);
      }
    });

    // 5. Incoming ICE candidate from peer
    this.socket.on('ice-candidate', async (candidateInit) => {
      await this.candidateQueue.addCandidate(candidateInit);
    });
  }

  dispose() {
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
  } catch (err) {
    console.warn('Failed to fetch /api/ice-config, falling back to public STUN:', err);
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
function showToast(message, type = 'info', durationMs = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
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
    background: ${type === 'error' ? 'rgba(255, 71, 87, 0.9)' : type === 'success' ? 'rgba(81, 207, 102, 0.9)' : 'rgba(51, 154, 240, 0.9)'};
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

// Attach to window object
window.WebRTCUtils = {
  objectFitRect,
  IceCandidateQueue,
  PerfectNegotiator,
  fetchIceConfig,
  showToast
};
