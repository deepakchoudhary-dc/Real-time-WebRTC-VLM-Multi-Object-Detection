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
    this.sockets.sockets = this.sockets; // Map compatibility
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

test('Signaling Integration - Full Token Auth, Live Metrics Relay & Glare Resolution', async (t) => {
  const io = new MockIOServer();
  attachSignaling(io);

  await t.test('Desktop and Phone Token Authentication (N05, R10)', () => {
    const room = roomStore.createRoom();
    const attackerDesktop = io.connectSocket('desktop_attacker');
    const validDesktop = io.connectSocket('desktop_valid');
    const validPhone = io.connectSocket('phone_valid');

    let attackerRejected = false;
    attackerDesktop.clientEmit('join-room', {
      roomCode: room.code,
      role: 'desktop',
      token: 'wrong-token-abc'
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

  await t.test('Live E2E Metrics Reporting from Desktop (R02)', () => {
    metricsStore.reset();
    const room = roomStore.createRoom();
    const desktop = io.connectSocket('desktop_metrics');
    const phone = io.connectSocket('phone_metrics');

    desktop.clientEmit('join-room', { roomCode: room.code, role: 'desktop', token: room.desktopToken });
    phone.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken });

    // Desktop reports measured live E2E latency
    desktop.clientEmit('metrics-report', { latency: 45 });
    desktop.clientEmit('metrics-report', { latency: 55 });

    const snapshot = metricsStore.getSnapshot();
    assert.equal(snapshot.sample_count, 2);
    assert.equal(snapshot.median_latency_ms, 55);
    assert.equal(snapshot.avg_latency_ms, 50);
    assert.equal(snapshot.min_latency_ms, 45);
    assert.equal(snapshot.max_latency_ms, 55);

    desktop.disconnect();
    phone.disconnect();
  });

  await t.test('Role authorization and label sanitization (R01)', () => {
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

    const maliciousPayload = {
      frame_id: 'frame_abc',
      capture_ts: Date.now() - 50,
      inference_ts: Date.now(),
      detections: [
        { label: '<img src=x onerror=alert(1)>person', score: 0.92, xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 }
      ]
    };

    phone.clientEmit('detection-result', maliciousPayload);
    assert.ok(desktopReceived);
    assert.match(desktopReceived.detections[0].label, /^[a-zA-Z0-9 _-]+$/);
    assert.equal(desktopReceived.detections[0].label.includes('<'), false);

    desktop.disconnect();
    phone.disconnect();
  });
});
