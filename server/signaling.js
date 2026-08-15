'use strict';

const logger = require('./logger');
const { roomStore } = require('./room-store');
const { metricsStore } = require('./metrics');
const { SocketRateLimiter } = require('./rate-limiter');

// COCO-80 label set allowlist for strict input sanitation (G09, R01)
const COCO_LABELS = new Set([
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
  'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
]);

/**
 * Sanitize and validate detection result payload (G09, R01)
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
      const cleanLabel = d.label.toLowerCase().trim();
      // Enforce COCO allowlist (G09)
      if (COCO_LABELS.has(cleanLabel)) {
        validDetections.push({
          label: cleanLabel,
          score: Math.round(d.score * 1000) / 1000,
          xmin: Math.max(0, Math.min(1, d.xmin)),
          ymin: Math.max(0, Math.min(1, d.ymin)),
          xmax: Math.max(0, Math.min(1, d.xmax)),
          ymax: Math.max(0, Math.min(1, d.ymax))
        });
      }
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

    // Middleware check on every event for socket rate limiting (N31)
    socket.use(([event, ...args], next) => {
      if (!rateLimiter.allowEvent()) {
        logger.warn(`Socket rate limit exceeded for ${socket.id}, event: ${event}`);
        socket.emit('error-message', { error: 'Rate limit exceeded. Too many socket events.' });
        return next(new Error('Rate limit exceeded.'));
      }
      next();
    });

    // ── 1. Room Joining (N05, N09, G08, R07) ─────────────────────────
    socket.on('join-room', (payload, callback) => {
      if (!payload || typeof payload !== 'object') {
        const err = { error: 'Invalid join-room payload.' };
        if (typeof callback === 'function') callback(err);
        socket.emit('error-message', err);
        return;
      }

      const { roomCode, role, token } = payload;
      const isSocketAlive = (id) => {
        const socketsMap = io.sockets?.sockets || io.sockets;
        return socketsMap ? (socketsMap.has ? socketsMap.has(id) : !!socketsMap.get?.(id)) : false;
      };

      const result = roomStore.joinRoom(roomCode, role, socket.id, token, isSocketAlive);

      if (!result.success) {
        logger.warn(`Failed join attempt: ${socket.id} -> ${logger.maskCode(roomCode)} (${result.error})`);
        const err = { error: result.error };
        if (typeof callback === 'function') callback(err);
        socket.emit('error-message', err);
        return;
      }

      const { room, peerSocketId, bufferedOffer, previousLeave } = result;
      logger.info(`Peer joined room: ${logger.maskCode(room.code)} as ${role} (id: ${socket.id})`);

      // If this socket was previously in another room, notify previous peer (R07)
      if (previousLeave && previousLeave.otherPeerId) {
        io.to(previousLeave.otherPeerId).emit('peer-left', { role: previousLeave.role });
      }

      const ackData = {
        success: true,
        roomCode: room.code,
        role,
        hasPeer: !!peerSocketId
      };

      if (typeof callback === 'function') callback(ackData);
      socket.emit('room-joined', ackData);

      // Notify the other peer if already in the room
      if (peerSocketId) {
        io.to(peerSocketId).emit('peer-joined', { role });
      }

      // Deliver buffered offer if designated for this peer (N10)
      if (bufferedOffer) {
        logger.info(`Delivering buffered offer to ${role} in room ${logger.maskCode(room.code)}`);
        socket.emit('offer', bufferedOffer);
      }
    });

    // ── 2. WebRTC SDP Offer (Bidirectional Buffering, N10) ────────────
    socket.on('offer', (offerData) => {
      const validSdp = validateSdp(offerData);
      if (!validSdp) return;

      const roomInfo = roomStore.getRoomBySocketId(socket.id);
      if (!roomInfo) return;

      roomStore.touchRoom(roomInfo.meta.roomCode);
      const peerSocketId = roomStore.getPeerSocketId(socket.id);

      const socketsMap = io.sockets?.sockets || io.sockets;
      const isPeerAlive = socketsMap ? (socketsMap.has ? socketsMap.has(peerSocketId) : !!socketsMap.get?.(peerSocketId)) : !!peerSocketId;

      if (peerSocketId && isPeerAlive) {
        // Point-to-peer relay directly to the peer's socket
        io.to(peerSocketId).emit('offer', validSdp);
      } else {
        // Buffer offer on server until peer joins (N10)
        logger.debug(`Buffering offer from ${roomInfo.meta.role} for room ${logger.maskCode(roomInfo.meta.roomCode)}`);
        roomStore.setPendingOffer(roomInfo.meta.roomCode, validSdp, roomInfo.meta.role, socket.id);
      }
    });

    // ── 3. WebRTC SDP Answer (Point-to-peer relay) ───────────────────
    socket.on('answer', (answerData) => {
      const validSdp = validateSdp(answerData);
      if (!validSdp) return;

      const roomInfo = roomStore.getRoomBySocketId(socket.id);
      if (roomInfo) {
        roomStore.touchRoom(roomInfo.meta.roomCode);
      }

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      if (peerSocketId) {
        io.to(peerSocketId).emit('answer', validSdp);
      }
    });

    // ── 4. WebRTC ICE Candidate (Bi-directional) ─────────────────────
    socket.on('ice-candidate', (candidateData) => {
      const validCandidate = validateIceCandidate(candidateData);
      if (!validCandidate) return;

      const roomInfo = roomStore.getRoomBySocketId(socket.id);
      if (roomInfo) {
        roomStore.touchRoom(roomInfo.meta.roomCode);
      }

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      if (peerSocketId) {
        io.to(peerSocketId).emit('ice-candidate', validCandidate);
      }
    });

    // ── 5. Detection Result Relay (Phone -> Desktop, N15) ─────────────
    socket.on('detection-result', (resultData) => {
      const roomInfo = roomStore.getRoomBySocketId(socket.id);
      if (!roomInfo || roomInfo.meta.role !== 'phone') {
        return; // Only phone is authorized to push detection-results
      }

      const validResult = validateDetectionResult(resultData);
      if (!validResult) return;

      roomStore.touchRoom(roomInfo.meta.roomCode);

      const peerSocketId = roomStore.getPeerSocketId(socket.id);
      if (peerSocketId) {
        metricsStore.incrementProcessedFrames();
        io.to(peerSocketId).emit('detection-result', validResult);
      }
    });

    // ── 6. Metrics Reporting from Client (Desktop -> Server, R02) ────
    socket.on('metrics-report', (report) => {
      const roomInfo = roomStore.getRoomBySocketId(socket.id);
      if (!roomInfo || roomInfo.meta.role !== 'desktop') {
        return; // Only desktop reports canonical E2E latency measurements
      }

      if (report && typeof report.latency === 'number' && Number.isFinite(report.latency)) {
        metricsStore.recordLatency(report.latency);
      }
    });

    // ── 7. Disconnect Handling ───────────────────────────────────────
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
  validateIceCandidate,
  COCO_LABELS
};
