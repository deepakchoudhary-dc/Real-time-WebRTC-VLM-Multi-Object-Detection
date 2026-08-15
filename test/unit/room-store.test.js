'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomStore } = require('../../server/room-store');

test('RoomStore - Room creation and code generation', () => {
  const store = new RoomStore({ maxRooms: 10, roomTtlMs: 10000 });

  const code1 = store.generateRoomCode(6);
  assert.equal(code1.length, 6);
  assert.match(code1, /^[A-HJ-NP-Z2-9]{6}$/); // No 0, O, 1, I

  const room = store.createRoom();
  assert.ok(room.code);
  assert.ok(room.token);
  assert.equal(room.desktop, null);
  assert.equal(room.phone, null);
  assert.equal(store.activeRoomsCount, 1);

  store.dispose();
});

test('RoomStore - Role slot enforcement and authentication', () => {
  const store = new RoomStore({ maxRooms: 10 });
  const room = store.createRoom();

  // Desktop joins
  const join1 = store.joinRoom(room.code, 'desktop', 'socket_desktop_1');
  assert.equal(join1.success, true);
  assert.equal(room.desktop, 'socket_desktop_1');

  // Phone joins without token -> Rejected
  const joinPhoneNoToken = store.joinRoom(room.code, 'phone', 'socket_phone_1', null);
  assert.equal(joinPhoneNoToken.success, false);
  assert.match(joinPhoneNoToken.error, /token required/i);

  // Phone joins with invalid token -> Rejected
  const joinPhoneBadToken = store.joinRoom(room.code, 'phone', 'socket_phone_1', 'wrong-token');
  assert.equal(joinPhoneBadToken.success, false);
  assert.match(joinPhoneBadToken.error, /Invalid room token/i);

  // Phone joins with valid token -> Accepted
  const joinPhoneValid = store.joinRoom(room.code, 'phone', 'socket_phone_1', room.token);
  assert.equal(joinPhoneValid.success, true);
  assert.equal(room.phone, 'socket_phone_1');

  // 3rd peer attempts to join occupied desktop slot -> Rejected
  const joinDesktop3rd = store.joinRoom(room.code, 'desktop', 'socket_attacker');
  assert.equal(joinDesktop3rd.success, false);
  assert.match(joinDesktop3rd.error, /already occupied/i);

  // 3rd peer attempts to join occupied phone slot -> Rejected
  const joinPhone3rd = store.joinRoom(room.code, 'phone', 'socket_attacker_phone', room.token);
  assert.equal(joinPhone3rd.success, false);
  assert.match(joinPhone3rd.error, /already occupied/i);

  // Point-to-peer routing verification
  assert.equal(store.getPeerSocketId('socket_desktop_1'), 'socket_phone_1');
  assert.equal(store.getPeerSocketId('socket_phone_1'), 'socket_desktop_1');

  store.dispose();
});

test('RoomStore - Offer buffering', () => {
  const store = new RoomStore();
  const room = store.createRoom();

  const dummyOffer = { type: 'offer', sdp: 'v=0...' };
  store.setPendingOffer(room.code, dummyOffer, 'phone_sock');

  const fetched = store.getRoom(room.code);
  assert.deepEqual(fetched.pendingOffer.offer, dummyOffer);

  store.clearPendingOffer(room.code);
  assert.equal(fetched.pendingOffer, null);

  store.dispose();
});

test('RoomStore - Leave room and GC sweep', () => {
  const store = new RoomStore({ roomTtlMs: 50 }); // 50ms TTL for testing
  const room = store.createRoom();

  store.joinRoom(room.code, 'desktop', 'sock_d');
  store.joinRoom(room.code, 'phone', 'sock_p', room.token);

  const leaveResult = store.leaveRoom('sock_d');
  assert.equal(leaveResult.role, 'desktop');
  assert.equal(leaveResult.otherPeerId, 'sock_p');
  assert.equal(room.desktop, null);

  // Wait for TTL to expire
  return new Promise((resolve) => {
    setTimeout(() => {
      store.sweep();
      assert.equal(store.getRoom(room.code), null);
      store.dispose();
      resolve();
    }, 60);
  });
});
