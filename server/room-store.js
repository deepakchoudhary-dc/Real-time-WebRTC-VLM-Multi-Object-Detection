'use strict';

const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const { safeCompareTokens } = require('./security');

const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 30 chars, no ambiguous 0/O, 1/I

class RoomStore {
  constructor(options = {}) {
    this.maxRooms = options.maxRooms || config.MAX_ROOMS;
    this.roomTtlMs = options.roomTtlMs || config.ROOM_TTL_MS;
    this.tokenTtlMs = options.tokenTtlMs || config.TOKEN_TTL_MS; // 15 min token TTL (R10)
    this.abandonmentTtlMs = options.abandonmentTtlMs || config.ROOM_ABANDONMENT_TTL_MS;
    this.neverJoinedTtlMs = options.neverJoinedTtlMs || config.NEVER_JOINED_ROOM_TTL_MS; // 60s never-joined sweep (H13)
    this.sweepCallback = null;

    // roomCode -> RoomObject
    this.rooms = new Map();
    // socketId -> { roomCode, role }
    this.socketMap = new Map();
  }

  setSweepCallback(fn) {
    this.sweepCallback = fn;
  }

  generateRoomCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
      const idx = crypto.randomInt(0, SAFE_ALPHABET.length);
      code += SAFE_ALPHABET[idx];
    }
    return code;
  }

  generateToken() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Create a new room with separate desktop and phone tokens (N05, G07, H13)
   */
  createRoom() {
    if (this.rooms.size >= this.maxRooms) {
      this.sweep(this.sweepCallback);
      if (this.rooms.size >= this.maxRooms) {
        throw new Error('Server room limit reached. Please try again later.');
      }
    }

    let roomCode;
    let attempts = 0;
    do {
      roomCode = this.generateRoomCode(6);
      attempts++;
    } while (this.rooms.has(roomCode) && attempts < 20);

    if (this.rooms.has(roomCode)) {
      throw new Error('Failed to allocate unique room code after multiple attempts.');
    }

    const desktopToken = this.generateToken();
    const phoneToken = this.generateToken();

    const room = {
      code: roomCode,
      desktopToken,
      phoneToken,
      desktop: null,
      phone: null,
      pendingOffer: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hasEverJoined: false
    };

    this.rooms.set(roomCode, room);
    logger.debug(`Room created: ${logger.maskCode(roomCode)}`);
    return room;
  }

  getRoom(roomCode) {
    if (!roomCode || typeof roomCode !== 'string') return null;
    return this.rooms.get(roomCode.trim().toUpperCase()) || null;
  }

  getRoomBySocketId(socketId) {
    const meta = this.socketMap.get(socketId);
    if (!meta) return null;
    return {
      meta,
      room: this.rooms.get(meta.roomCode) || null
    };
  }

  touchRoom(roomCode) {
    const room = this.getRoom(roomCode);
    if (room) {
      room.updatedAt = Date.now();
    }
  }

  /**
   * Join a room with authoritative same-token reconnect grace and token TTL (P19, R10, H1, H4)
   */
  joinRoom(roomCode, role, socketId, token) {
    if (!roomCode || typeof roomCode !== 'string') {
      return { success: false, error: 'Invalid room code' };
    }
    const cleanCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      return { success: false, error: 'Room does not exist' };
    }

    if (role !== 'desktop' && role !== 'phone') {
      return { success: false, error: 'Invalid role. Must be desktop or phone.' };
    }

    if (!token || typeof token !== 'string') {
      return { success: false, error: `${role} authentication token required.` };
    }

    // Authenticate token using constant-time comparison (R10, R11)
    const expectedToken = role === 'desktop' ? room.desktopToken : room.phoneToken;
    if (!safeCompareTokens(token, expectedToken)) {
      return { success: false, error: `Invalid ${role} authentication token. Access denied.` };
    }

    // Enforce Token TTL (R10)
    const now = Date.now();
    if (now - room.createdAt > this.tokenTtlMs) {
      return { success: false, error: 'Authentication token has expired. Please refresh session.' };
    }

    // 1. Idempotent Join Check (H1): If this socket already holds this slot in this room, do nothing
    if (room[role] === socketId) {
      room.updatedAt = now;
      return {
        success: true,
        room,
        peerSocketId: role === 'desktop' ? room.phone : room.desktop,
        bufferedOffer: null,
        previousLeave: null
      };
    }

    // 2. Authoritative Same-Token Reconnect & Reclaim (P19, G08, H4)
    const currentOccupant = room[role];
    if (currentOccupant && currentOccupant !== socketId) {
      logger.info(`Authoritative reconnect reclaiming slot '${role}' in room ${logger.maskCode(cleanCode)} for socket ${socketId}`);
      this.socketMap.delete(currentOccupant);
    }

    // 3. Leave any previously joined room (only if switching from a different room, H1, R07)
    let previousLeave = null;
    const existingMeta = this.socketMap.get(socketId);
    if (existingMeta && existingMeta.roomCode !== cleanCode) {
      previousLeave = this.leaveRoom(socketId);
    }

    // Assign slot
    room[role] = socketId;
    room.hasEverJoined = true;
    room.updatedAt = now;
    this.socketMap.set(socketId, { roomCode: cleanCode, role });

    // Check for buffered offer designated for this role (N10)
    let bufferedOffer = null;
    if (room.pendingOffer && room.pendingOffer.fromRole !== role) {
      bufferedOffer = room.pendingOffer.offer;
      room.pendingOffer = null;
    }

    return {
      success: true,
      room,
      peerSocketId: role === 'desktop' ? room.phone : room.desktop,
      bufferedOffer,
      previousLeave
    };
  }

  /**
   * Buffer an offer from any role (N10)
   */
  setPendingOffer(roomCode, offer, fromRole, fromSocketId) {
    const room = this.getRoom(roomCode);
    if (!room) return false;
    room.pendingOffer = {
      offer,
      fromRole,
      fromSocketId,
      timestamp: Date.now()
    };
    room.updatedAt = Date.now();
    return true;
  }

  getPeerSocketId(socketId) {
    const record = this.socketMap.get(socketId);
    if (!record) return null;
    const room = this.rooms.get(record.roomCode);
    if (!room) return null;

    return record.role === 'desktop' ? room.phone : room.desktop;
  }

  leaveRoom(socketId) {
    const record = this.socketMap.get(socketId);
    if (!record) return null;

    const { roomCode, role } = record;
    this.socketMap.delete(socketId);

    const room = this.rooms.get(roomCode);
    if (room) {
      if (room[role] === socketId) {
        room[role] = null;
      }
      room.updatedAt = Date.now();

      const otherPeerId = role === 'desktop' ? room.phone : room.desktop;
      return { roomCode, role, otherPeerId };
    }

    return { roomCode, role, otherPeerId: null };
  }

  /**
   * Sweep stale/abandoned rooms based on liveness (never killing active streams, H13, N08, N43)
   */
  sweep(onRoomSweep) {
    const callback = onRoomSweep || this.sweepCallback;
    const now = Date.now();
    let swept = 0;

    for (const [code, room] of this.rooms.entries()) {
      const isExpired = (now - room.updatedAt > this.roomTtlMs);
      const isNeverJoined = (!room.hasEverJoined && !room.desktop && !room.phone && (now - room.createdAt > this.neverJoinedTtlMs));
      const isAbandoned = (room.hasEverJoined && !room.desktop && !room.phone && (now - room.updatedAt > this.abandonmentTtlMs));

      if (isExpired || isNeverJoined || isAbandoned) {
        if (typeof callback === 'function') {
          if (room.desktop) callback(room.desktop, code);
          if (room.phone) callback(room.phone, code);
        }

        if (room.desktop) this.socketMap.delete(room.desktop);
        if (room.phone) this.socketMap.delete(room.phone);
        this.rooms.delete(code);
        swept++;
      }
    }

    if (swept > 0) {
      logger.debug(`RoomStore GC swept ${swept} stale rooms. Active rooms: ${this.rooms.size}`);
    }
  }

  get activeRoomsCount() {
    return this.rooms.size;
  }

  get activeConnectionsCount() {
    return this.socketMap.size;
  }

  dispose() {
    this.rooms.clear();
    this.socketMap.clear();
  }
}

const roomStore = new RoomStore();

module.exports = {
  RoomStore,
  roomStore
};
