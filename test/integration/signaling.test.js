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

  await t.test('Idempotent Re-Join produces no spurious peer-left (H1)', () => {
    const room = roomStore.createRoom();
    const desktop = io.connectSocket('desktop_idem');
    const phone = io.connectSocket('phone_idem');

    let peerLeftEmitted = false;
    phone.on('client_received_peer-left', () => {
      peerLeftEmitted = true;
    });

    desktop.clientEmit('join-room', { roomCode: room.code, role: 'desktop', token: room.desktopToken });
    phone.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken });

    // Desktop re-joins the same room (pageshow / reconnect simulation)
    desktop.clientEmit('join-room', { roomCode: room.code, role: 'desktop', token: room.desktopToken });

    // Assert no spurious peer-left was emitted to the phone
    assert.equal(peerLeftEmitted, false);

    desktop.disconnect();
    phone.disconnect();
  });

  await t.test('Authoritative Same-Token Reconnect and Reclaim (P19, G08)', () => {
    const room = roomStore.createRoom();
    const phoneOld = io.connectSocket('phone_old_sock');
    const desktop = io.connectSocket('desktop_watch');

    desktop.clientEmit('join-room', { roomCode: room.code, role: 'desktop', token: room.desktopToken });
    phoneOld.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken });
    assert.equal(room.phone, 'phone_old_sock');

    // Phone reconnects on new socket with the authoritative secret phoneToken
    const phoneNew = io.connectSocket('phone_new_sock');
    let reconnectSuccess = false;
    phoneNew.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken }, (ack) => {
      if (ack && ack.success) reconnectSuccess = true;
    });

    assert.equal(reconnectSuccess, true);
    assert.equal(room.phone, 'phone_new_sock');
    assert.equal(roomStore.socketMap.has('phone_old_sock'), false);

    desktop.disconnect();
    phoneOld.disconnect();
    phoneNew.disconnect();
  });

  await t.test('Real-time Detect Mode Propagation (H3)', () => {
    const room = roomStore.createRoom();
    const desktop = io.connectSocket('desktop_mode');
    const phone = io.connectSocket('phone_mode');

    desktop.clientEmit('join-room', { roomCode: room.code, role: 'desktop', token: room.desktopToken });
    phone.clientEmit('join-room', { roomCode: room.code, role: 'phone', token: room.phoneToken });

    let phoneReceivedMode = null;
    phone.on('client_received_detect-mode', (data) => {
      phoneReceivedMode = data.mode;
    });

    // Desktop switches to desktop mode
    desktop.clientEmit('detect-mode', { mode: 'desktop' });
    assert.equal(phoneReceivedMode, 'desktop');

    desktop.disconnect();
    phone.disconnect();
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

  await t.test('Role authorization and COCO label allowlist enforcement (G09, R01, N35)', () => {
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

    const mixedPayload = {
      capture_ts: Date.now() - 50,
      detections: [
        { label: 'person', score: 0.92, xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
        { label: 'malicious_non_coco_tag', score: 0.88, xmin: 0.2, ymin: 0.3, xmax: 0.6, ymax: 0.7 }
      ]
    };

    phone.clientEmit('detection-result', mixedPayload);
    assert.ok(desktopReceived);
    // Non-COCO tag was filtered out, valid 'person' tag kept (G09)
    assert.equal(desktopReceived.detections.length, 1);
    assert.equal(desktopReceived.detections[0].label, 'person');
    assert.ok(desktopReceived.capture_ts);
    assert.equal('frame_id' in desktopReceived, false); // Cleaned up (N35)
    assert.equal('inference_ts' in desktopReceived, false);

    desktop.disconnect();
    phone.disconnect();
  });
});
