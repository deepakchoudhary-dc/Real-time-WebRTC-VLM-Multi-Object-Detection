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
   * Create or register a new room
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

    const token = this.generateToken();
    const room = {
      code: roomCode,
      token,
      desktop: null,
      phone: null,
      pendingOffer: null, // Buffered offer from phone if desktop hasn't joined yet
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

  /**
   * Attempt to join a room
   */
  joinRoom(roomCode, role, socketId, token) {
    if (!roomCode || typeof roomCode !== 'string') {
      return { success: false, error: 'Invalid room code' };
    }
    const cleanCode = roomCode.trim().toUpperCase();
    let room = this.rooms.get(cleanCode);

    if (role !== 'desktop' && role !== 'phone') {
      return { success: false, error: 'Invalid role. Must be desktop or phone.' };
    }

    // If desktop tries to join a non-existent room with a valid token, allow initializing it
    if (!room && role === 'desktop') {
      room = {
        code: cleanCode,
        token: token || this.generateToken(),
        desktop: null,
        phone: null,
        pendingOffer: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.rooms.set(cleanCode, room);
    }

    if (!room) {
      return { success: false, error: 'Room does not exist' };
    }

    // Phone MUST provide valid token matching room.token
    if (role === 'phone') {
      if (!token || typeof token !== 'string') {
        return { success: false, error: 'Room token required for camera authentication' };
      }
      if (token !== room.token) {
        return { success: false, error: 'Invalid room token. Access denied.' };
      }
    }

    // Check if slot is already actively occupied by a DIFFERENT socket
    const currentOccupant = room[role];
    if (currentOccupant && currentOccupant !== socketId) {
      return { success: false, error: `Role slot '${role}' is already occupied.` };
    }

    // Leave any previously joined room
    this.leaveRoom(socketId);

    // Assign slot
    room[role] = socketId;
    room.updatedAt = Date.now();
    this.socketMap.set(socketId, { roomCode: cleanCode, role });

    return {
      success: true,
      room,
      peerSocketId: role === 'desktop' ? room.phone : room.desktop,
      pendingOffer: role === 'desktop' ? room.pendingOffer : null
    };
  }

  /**
   * Store pending offer if peer is not yet connected
   */
  setPendingOffer(roomCode, offer, fromSocketId) {
    const room = this.getRoom(roomCode);
    if (!room) return false;
    room.pendingOffer = { offer, from: fromSocketId, timestamp: Date.now() };
    room.updatedAt = Date.now();
    return true;
  }

  clearPendingOffer(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;
    room.pendingOffer = null;
  }

  /**
   * Get the peer socket ID for a given socket in its room
   */
  getPeerSocketId(socketId) {
    const record = this.socketMap.get(socketId);
    if (!record) return null;
    const room = this.rooms.get(record.roomCode);
    if (!room) return null;

    return record.role === 'desktop' ? room.phone : room.desktop;
  }

  /**
   * Socket disconnect or leave
   */
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

      // If both left and empty for a while, it will be swept
      const otherPeerId = role === 'desktop' ? room.phone : room.desktop;
      return { roomCode, role, otherPeerId, roomEmpty: !room.desktop && !room.phone };
    }

    return { roomCode, role, otherPeerId: null, roomEmpty: true };
  }

  /**
   * Garbage collect expired and abandoned rooms
   */
  sweep() {
    const now = Date.now();
    let swept = 0;

    for (const [code, room] of this.rooms.entries()) {
      const isExpired = now - room.createdAt > this.roomTtlMs;
      const isAbandoned = !room.desktop && !room.phone && (now - room.updatedAt > 5 * 60 * 1000);

      if (isExpired || isAbandoned) {
        // Disconnect any lingering socket map references
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
