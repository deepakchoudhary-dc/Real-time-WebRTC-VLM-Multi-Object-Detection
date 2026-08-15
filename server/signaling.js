'use strict';

const logger = require('./logger');
const { roomStore } = require('./room-store');
const { metricsStore } = require('./metrics');
const { SocketRateLimiter } = require('./rate-limiter');

/**
 * Sanitize and validate detection result payload
 */
function validateDetectionResult(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.detections)) return null;
  if (payload.detections.length > 100) return null;

  const validDetections = [];
  for (const d of payload.detections) {
    if (
      d &&
      typeof d.label === 'string' &&
      d.label.length <= 64 &&
      typeof d.score === 'number' &&
      Number.isFinite(d.score) &&
      d.score >= 0 &&
      d.score <= 1 &&
      typeof d.xmin === 'number' &&
      Number.isFinite(d.xmin) &&
      typeof d.ymin === 'number' &&
      Number.isFinite(d.ymin) &&
      typeof d.xmax === 'number' &&
      Number.isFinite(d.xmax) &&
      typeof d.ymax === 'number' &&
      Number.isFinite(d.ymax)
    ) {
      validDetections.push({
        label: d.label,
        score: Math.round(d.score * 1000) / 1000,
        xmin: Math.max(0, Math.min(1, d.xmin)),
        ymin: Math.max(0, Math.min(1, d.ymin)),
        xmax: Math.max(0, Math.min(1, d.xmax)),
        ymax: Math.max(0, Math.min(1, d.ymax))
      });
    }
  }

  const captureTs = typeof payload.capture_ts === 'number' && Number.isFinite(payload.capture_ts)
    ? payload.capture_ts
    : Date.now();

  const inferenceTs = typeof payload.inference_ts === 'number' && Number.isFinite(payload.inference_ts)
    ? payload.inference_ts
    : Date.now();

  return {
    frame_id: String(payload.frame_id || '').substring(0, 64),
    capture_ts: captureTs,
    inference_ts: inferenceTs,
    detections: validDetections
  };
}

/**
 * Validate SDP description payload (offer/answer)
 */
function validateSdp(sdp) {
  if (!sdp || typeof sdp !== 'object') return null;
  if (typeof sdp.type !== 'string' || typeof sdp.sdp !== 'string') return null;
  if (sdp.type !== 'offer' && sdp.type !== 'answer' && sdp.type !== 'pranswer' && sdp.type !== 'rollback') {
    return null;
  }
  // Sanity check length
  if (sdp.sdp.length > 200_000) return null;
  return {
    type: sdp.type,
    sdp: sdp.sdp
  };
}

/**
 * Validate ICE candidate payload
 */
function validateIceCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  // May be null candidate (end-of-candidates indication in spec)
  if (candidate.candidate === null || candidate.candidate === '') {
    return { candidate: null };
  }
  if (typeof candidate.candidate !== 'string') return null;
  return {
    candidate: candidate.candidate,
    sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null,
    sdpMLineIndex: typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : null,
    usernameFragment: typeof candidate.usernameFragment === 'string' ? candidate.usernameFragment : null
  };
}

/**
 * Attach signaling handlers to Socket.IO instance
 */
function attachSignaling(io) {
  io.on('connection', (socket) => {
    const rateLimiter = new SocketRateLimiter();
    logger.debug(`Socket connected: ${socket.id}`);

    // Middleware check on every event for socket rate limiting
    socket.use(([event, ...args], next) => {
      if (!rateLimiter.allowEvent()) {
        logger.warn(`Socket rate limit exceeded for ${socket.id}, event: ${event}`);
        return next(new Error('Rate limit exceeded. Too many socket events.'));
      }
      next();
    });

    // ── 1. Room Joining ──────────────────────────────────────────────
    socket.on('join-room', (payload, callback) => {
      if (!payload || typeof payload !== 'object') {
        const err = { error: 'Invalid join-room payload.' };
        if (typeof callback === 'function') callback(err);
        socket.emit('error-message', err);
        return;
      }

      const { roomCode, role, token } = payload;
      const result = roomStore.joinRoom(roomCode, role, socket.id, token);

      if (!result.success) {
        logger.warn(`Failed join attempt: ${socket.id} -> ${logger.maskCode(roomCode)} (${result.error})`);
        const err = { error: result.error };
        if (typeof callback === 'function') callback(err);
        socket.emit('error-message', err);
        return;
      }

      const { room, peerSocketId, pendingOffer } = result;
      logger.info(`Peer joined room: ${logger.maskCode(room.code)} as ${role} (id: ${socket.id})`);

      const ackData = {
        success: true,
        roomCode: room.code,
        role,
        hasPeer: !!peerSocketId,
        hasPendingOffer: !!pendingOffer
      };

      if (typeof callback === 'function') callback(ackData);
      socket.emit('room-joined', ackData);

      // Notify the other peer if already in the room
      if (peerSocketId) {
        io.to(peerSocketId).emit('peer-joined', { role });

        // If desktop just joined and phone has a buffered pending offer, deliver it now!
        if (role === 'desktop' && pendingOffer) {
          logger.info(`Delivering buffered offer to desktop in room ${logger.maskCode(room.code)}`);
          socket.emit('offer', pendingOffer.offer);
          roomStore.clearPendingOffer(room.code);
        }
      }
    });

    // ── 2. WebRTC SDP Offer (Phone -> Desktop or vice versa) ──────────
    socket.on('offer', (offerData) => {
      const validSdp = validateSdp(offerData);
      if (!validSdp) return;

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      const roomInfo = roomStore.getRoomBySocketId(socket.id);

      if (!roomInfo) return;

      if (peerSocketId) {
        // Point-to-peer relay directly to the peer's socket
        io.to(peerSocketId).emit('offer', validSdp);
      } else if (roomInfo.meta.role === 'phone') {
        // Buffer offer on server until desktop joins
        logger.debug(`Buffering offer from phone for room ${logger.maskCode(roomInfo.meta.roomCode)}`);
        roomStore.setPendingOffer(roomInfo.meta.roomCode, validSdp, socket.id);
      }
    });

    // ── 3. WebRTC SDP Answer (Desktop -> Phone) ──────────────────────
    socket.on('answer', (answerData) => {
      const validSdp = validateSdp(answerData);
      if (!validSdp) return;

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      if (peerSocketId) {
        io.to(peerSocketId).emit('answer', validSdp);
      }
    });

    // ── 4. WebRTC ICE Candidate (Bi-directional) ─────────────────────
    socket.on('ice-candidate', (candidateData) => {
      const validCandidate = validateIceCandidate(candidateData);
      if (!validCandidate) return;

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      if (peerSocketId) {
        io.to(peerSocketId).emit('ice-candidate', validCandidate);
      }
    });

    // ── 5. Detection Result Relay (Phone -> Desktop) ─────────────────
    socket.on('detection-result', (resultData) => {
      const roomInfo = roomStore.getRoomBySocketId(socket.id);
      if (!roomInfo || roomInfo.meta.role !== 'phone') {
        return; // Only phone is authorized to push detection-results
      }

      const validResult = validateDetectionResult(resultData);
      if (!validResult) return;

      metricsStore.incrementProcessedFrames();
      metricsStore.incrementTotalFrames();

      const latency = Date.now() - validResult.capture_ts;
      metricsStore.recordLatency(latency);

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      if (peerSocketId) {
        io.to(peerSocketId).emit('detection-result', validResult);
      }
    });

    // ── 6. Disconnect Handling ───────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} (${reason})`);
      const leaveResult = roomStore.leaveRoom(socket.id);

      if (leaveResult && leaveResult.otherPeerId) {
        io.to(leaveResult.otherPeerId).emit('peer-left', { role: leaveResult.role });
      }
    });
  });
}

module.exports = {
  attachSignaling,
  validateDetectionResult,
  validateSdp,
  validateIceCandidate
};
