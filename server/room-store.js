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
    this.abandonmentTtlMs = options.abandonmentTtlMs || config.ROOM_ABANDONMENT_TTL_MS;
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
   * Create a new room with separate desktop and phone tokens (N05, G07)
   */
  createRoom() {
    if (this.rooms.size >= this.maxRooms) {
      this.sweep(this.sweepCallback); // Pass room-closed callback on overflow (G07)
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
      updatedAt: Date.now()
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
   * Join a room with full constant-time token authentication and server-side reconnect grace (N05, N09, G08, R10)
   */
  joinRoom(roomCode, role, socketId, token, isSocketAliveFn) {
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

    // Reconnection & Server-Side Grace Reclaim (N09, G08)
    const currentOccupant = room[role];
    if (currentOccupant && currentOccupant !== socketId) {
      let isOccupantLive = true;
      if (typeof isSocketAliveFn === 'function') {
        isOccupantLive = isSocketAliveFn(currentOccupant);
      } else {
        isOccupantLive = this.socketMap.has(currentOccupant);
      }

      if (isOccupantLive) {
        return { success: false, error: `Role slot '${role}' is already occupied.` };
      }
      logger.info(`Gracefully reclaiming disconnected slot '${role}' in room ${logger.maskCode(cleanCode)} for socket ${socketId}`);
    }

    // Leave any previously joined room (and return result for peer-left notification, R07)
    const previousLeave = this.leaveRoom(socketId);

    // Assign slot
    room[role] = socketId;
    room.updatedAt = Date.now();
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
   * Sweep stale/abandoned rooms based on liveness (updatedAt), never killing active streams (N08, N43, G07)
   */
  sweep(onRoomSweep) {
    const callback = onRoomSweep || this.sweepCallback;
    const now = Date.now();
    let swept = 0;

    for (const [code, room] of this.rooms.entries()) {
      const isExpired = (now - room.updatedAt > this.roomTtlMs);
      const isAbandoned = (!room.desktop && !room.phone && (now - room.updatedAt > this.abandonmentTtlMs));

      if (isExpired || isAbandoned) {
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
