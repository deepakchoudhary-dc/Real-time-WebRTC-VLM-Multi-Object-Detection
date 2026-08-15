'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { attachSignaling } = require('../../server/signaling');
const { roomStore } = require('../../server/room-store');
const { metricsStore } = require('../../server/metrics');

// Lightweight Mock Socket.IO Server & Client Harness
class MockSocket extends EventEmitter {
  constructor(id, ioServer) {
    super();
    this.id = id;
    this.ioServer = ioServer;
    this.middleware = [];
  }

  use(fn) {
    this.middleware.push(fn);
  }

  clientEmit(event, data, callback) {
    let idx = 0;
    const next = (err) => {
      if (err) {
        return;
      }
      idx++;
      if (idx < this.middleware.length) {
        this.middleware[idx]([event, data], next);
      } else {
        this.emit(event, data, callback);
      }
    };

    if (this.middleware.length > 0) {
      this.middleware[0]([event, data], next);
    } else {
      this.emit(event, data, callback);
    }
  }

  disconnect() {
    this.emit('disconnect', 'client namespace disconnect');
    this.ioServer.sockets.delete(this.id);
  }
}

class MockIOServer extends EventEmitter {
  constructor() {
    super();
    this.sockets = new Map();
  }

  connectSocket(id) {
    const socket = new MockSocket(id, this);
    this.sockets.set(id, socket);
    this.emit('connection', socket);
    return socket;
  }

  to(targetSocketId) {
    return {
      emit: (event, data) => {
        const target = this.sockets.get(targetSocketId);
        if (target) {
          target.emit(`client_received_${event}`, data);
        }
      }
    };
  }
}

test('Signaling Integration - Full Token Auth, Bidirectional Offer Buffering & Role Security', async (t) => {
  const io = new MockIOServer();
  attachSignaling(io);

  await t.test('Desktop and Phone Token Authentication (N05)', () => {
    const room = roomStore.createRoom();
    const attackerDesktop = io.connectSocket('desktop_attacker');
    const validDesktop = io.connectSocket('desktop_valid');
    const validPhone = io.connectSocket('phone_valid');

    let attackerRejected = false;
    attackerDesktop.clientEmit('join-room', {
      roomCode: room.code,
      role: 'desktop',
      token: 'wrong-token'
    }, (ack) => {
      if (!ack.success) attackerRejected = true;
    });
    assert.equal(attackerRejected, true);

    let desktopJoined = false;
    validDesktop.clientEmit('join-room', {
      roomCode: room.code,
      role: 'desktop',
      token: room.desktopToken
    }, (ack) => {
      if (ack.success) desktopJoined = true;
    });
    assert.equal(desktopJoined, true);

    let phoneJoined = false;
    validPhone.clientEmit('join-room', {
      roomCode: room.code,
      role: 'phone',
      token: room.phoneToken
    }, (ack) => {
      if (ack.success) phoneJoined = true;
    });
    assert.equal(phoneJoined, true);

    attackerDesktop.disconnect();
    validDesktop.disconnect();
    validPhone.disconnect();
  });

  await t.test('Offer Buffering - Phone offers before Desktop joins (N10)', () => {
    const room = roomStore.createRoom();
    const phone = io.connectSocket('phone_early');
    const desktop = io.connectSocket('desktop_late');

    const testOffer = { type: 'offer', sdp: 'v=0\r\no=dummy' };

    // 1. Phone joins first
    phone.clientEmit('join-room', {
      roomCode: room.code,
      role: 'phone',
      token: room.phoneToken
    }, (ack) => {
      assert.equal(ack.success, true);
    });

    // 2. Phone sends offer immediately (buffered on server)
    phone.clientEmit('offer', testOffer);
    assert.ok(room.pendingOffer);
    assert.equal(room.pendingOffer.offer.sdp, testOffer.sdp);

    // 3. Desktop joins later -> Receives buffered offer
    let receivedOffer = null;
    desktop.on('offer', (off) => {
      receivedOffer = off;
    });

    desktop.clientEmit('join-room', {
      roomCode: room.code,
      role: 'desktop',
      token: room.desktopToken
    }, (ack) => {
      assert.equal(ack.success, true);
    });

    assert.ok(receivedOffer);
    assert.equal(receivedOffer.sdp, testOffer.sdp);
    assert.equal(room.pendingOffer, null);

    desktop.disconnect();
    phone.disconnect();
  });

  await t.test('Role authorization - Only phone is allowed to relay detections', () => {
    metricsStore.reset();
    const room = roomStore.createRoom();
    const desktop = io.connectSocket('desktop_rec');
    const phone = io.connectSocket('phone_sender');

    desktop.clientEmit('join-room', { roomCode: room.code, role: 'desktop', token: room.desktopToken });
    phone.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken });

    let desktopReceived = null;
    desktop.on('client_received_detection-result', (data) => {
      desktopReceived = data;
    });

    const validPayload = {
      frame_id: 'frame_abc',
      capture_ts: Date.now() - 50,
      inference_ts: Date.now(),
      detections: [
        { label: 'person', score: 0.92, xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 }
      ]
    };

    phone.clientEmit('detection-result', validPayload);
    assert.ok(desktopReceived);
    assert.equal(desktopReceived.frame_id, 'frame_abc');
    assert.equal(metricsStore.processedFrames, 1);

    // Desktop attempts to emit detection result -> Ignored
    desktop.clientEmit('detection-result', validPayload);
    assert.equal(metricsStore.processedFrames, 1);

    desktop.disconnect();
    phone.disconnect();
  });

  await t.test('Socket event rate limiting notifies client with error-message (N31)', () => {
    const room = roomStore.createRoom();
    const spammer = io.connectSocket('spammer_socket');

    spammer.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken });

    let rateLimitBlocked = false;
    spammer.on('error-message', (err) => {
      if (/rate limit/i.test(err.error || '')) {
        rateLimitBlocked = true;
      }
    });

    for (let i = 0; i < 70; i++) {
      spammer.clientEmit('ice-candidate', { candidate: 'candidate:dummy' });
    }

    assert.equal(rateLimitBlocked, true);
    spammer.disconnect();
  });
});
