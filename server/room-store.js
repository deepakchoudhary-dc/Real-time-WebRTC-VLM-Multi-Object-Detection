'use strict';

const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');

const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 30 chars, no ambiguous 0/O, 1/I

class RoomStore {
  constructor(options = {}) {
    this.maxRooms = options.maxRooms || config.MAX_ROOMS;
    this.roomTtlMs = options.roomTtlMs || config.ROOM_TTL_MS;
    this.gcIntervalMs = options.gcIntervalMs || config.ROOM_GC_INTERVAL_MS;

    // roomCode -> RoomObject
    this.rooms = new Map();
    // socketId -> { roomCode, role }
    this.socketMap = new Map();

    // Start GC timer
    this.gcTimer = setInterval(() => this.sweep(), this.gcIntervalMs);
    if (this.gcTimer.unref) this.gcTimer.unref();
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
   * Create a new room with separate desktop and phone tokens (N05)
   */
  createRoom() {
    if (this.rooms.size >= this.maxRooms) {
      this.sweep();
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
      pendingOffer: null, // Buffered offer from peer if designated recipient not connected
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
   * Join a room with full token authentication for BOTH desktop and phone (N05, N06, N09)
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

    // Authenticate token for role (N05)
    const expectedToken = role === 'desktop' ? room.desktopToken : room.phoneToken;
    if (token !== expectedToken) {
      return { success: false, error: `Invalid ${role} authentication token. Access denied.` };
    }

    // Reconnection / Slot Reclaim support (N09)
    const currentOccupant = room[role];
    if (currentOccupant && currentOccupant !== socketId) {
      // Check if previous occupant socket is still valid
      const existingMeta = this.socketMap.get(currentOccupant);
      if (existingMeta) {
        // Slot is currently in active use by another live socket
        return { success: false, error: `Role slot '${role}' is already occupied.` };
      }
      // Stale slot reclaimed
      logger.info(`Reclaiming stale slot '${role}' in room ${logger.maskCode(cleanCode)} for socket ${socketId}`);
    }

    // Leave any previously joined room
    this.leaveRoom(socketId);

    // Assign slot
    room[role] = socketId;
    room.updatedAt = Date.now();
    this.socketMap.set(socketId, { roomCode: cleanCode, role });

    // Check for buffered offer designated for this role (N10)
    let bufferedOffer = null;
    if (room.pendingOffer && room.pendingOffer.fromRole !== role) {
      bufferedOffer = room.pendingOffer.offer;
      room.pendingOffer = null; // Consume buffered offer
    }

    return {
      success: true,
      room,
      peerSocketId: role === 'desktop' ? room.phone : room.desktop,
      bufferedOffer
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

  clearPendingOffer(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;
    room.pendingOffer = null;
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
      return { roomCode, role, otherPeerId, roomEmpty: !room.desktop && !room.phone };
    }

    return { roomCode, role, otherPeerId: null, roomEmpty: true };
  }

  /**
   * Sweep stale/abandoned rooms based on liveness (updatedAt), never killing active streams (N08)
   * @param {function} onRoomSweep - Callback to notify & disconnect active sockets if room expired
   */
  sweep(onRoomSweep) {
    const now = Date.now();
    let swept = 0;

    for (const [code, room] of this.rooms.entries()) {
      // Room is expired if inactive for roomTtlMs (liveness-based, N08)
      const isExpired = (now - room.updatedAt > this.roomTtlMs);
      const isAbandoned = (!room.desktop && !room.phone && (now - room.updatedAt > 5 * 60 * 1000));

      if (isExpired || isAbandoned) {
        if (typeof onRoomSweep === 'function') {
          if (room.desktop) onRoomSweep(room.desktop, code);
          if (room.phone) onRoomSweep(room.phone, code);
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
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }
}

const roomStore = new RoomStore();

module.exports = {
  RoomStore,
  roomStore
};
