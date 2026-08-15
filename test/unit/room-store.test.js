'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomStore } = require('../../server/room-store');

test('RoomStore - Room creation and token allocation', () => {
  const store = new RoomStore({ maxRooms: 10, roomTtlMs: 10000 });

  const code1 = store.generateRoomCode(6);
  assert.equal(code1.length, 6);
  assert.match(code1, /^[A-HJ-NP-Z2-9]{6}$/);

  const room = store.createRoom();
  assert.ok(room.code);
  assert.ok(room.desktopToken);
  assert.ok(room.phoneToken);
  assert.notEqual(room.desktopToken, room.phoneToken);
  assert.equal(room.desktop, null);
  assert.equal(room.phone, null);
  assert.equal(store.activeRoomsCount, 1);

  store.dispose();
});

test('RoomStore - Constant-Time Token Authentication (N05, R10, R11)', () => {
  const store = new RoomStore({ maxRooms: 10 });
  const room = store.createRoom();

  // 1. Desktop joins without token -> Rejected
  const joinDesktopNoToken = store.joinRoom(room.code, 'desktop', 'socket_d1', null);
  assert.equal(joinDesktopNoToken.success, false);
  assert.match(joinDesktopNoToken.error, /token required/i);

  // 2. Desktop joins with invalid token -> Rejected
  const joinDesktopBadToken = store.joinRoom(room.code, 'desktop', 'socket_d1', 'invalid-token-1234');
  assert.equal(joinDesktopBadToken.success, false);
  assert.match(joinDesktopBadToken.error, /Invalid desktop authentication token/i);

  // 3. Desktop joins with valid desktopToken -> Accepted
  const joinDesktopValid = store.joinRoom(room.code, 'desktop', 'socket_d1', room.desktopToken);
  assert.equal(joinDesktopValid.success, true);
  assert.equal(room.desktop, 'socket_d1');

  // 4. Phone joins with desktopToken -> Rejected
  const joinPhoneBadToken = store.joinRoom(room.code, 'phone', 'socket_p1', room.desktopToken);
  assert.equal(joinPhoneBadToken.success, false);
  assert.match(joinPhoneBadToken.error, /Invalid phone authentication token/i);

  // 5. Phone joins with valid phoneToken -> Accepted
  const joinPhoneValid = store.joinRoom(room.code, 'phone', 'socket_p1', room.phoneToken);
  assert.equal(joinPhoneValid.success, true);
  assert.equal(room.phone, 'socket_p1');

  // 6. Third-party attempts to occupy active slots -> Rejected
  const join3rd = store.joinRoom(room.code, 'desktop', 'socket_attacker', room.desktopToken);
  assert.equal(join3rd.success, false);
  assert.match(join3rd.error, /already occupied/i);

  store.dispose();
});

test('RoomStore - Reconnection Slot Reclaim (N09)', () => {
  const store = new RoomStore({ maxRooms: 10 });
  const room = store.createRoom();

  store.joinRoom(room.code, 'desktop', 'socket_d1', room.desktopToken);
  assert.equal(room.desktop, 'socket_d1');

  // Desktop disconnects (leaves room)
  store.leaveRoom('socket_d1');
  assert.equal(room.desktop, null);

  // Reconnecting desktop joins with new socket ID and same valid token -> Reclaims slot
  const reclaim = store.joinRoom(room.code, 'desktop', 'socket_d2_new', room.desktopToken);
  assert.equal(reclaim.success, true);
  assert.equal(room.desktop, 'socket_d2_new');

  store.dispose();
});

test('RoomStore - Room-switch leaves previous room and notifies peer (R07)', () => {
  const store = new RoomStore({ maxRooms: 10 });
  const room1 = store.createRoom();
  const room2 = store.createRoom();

  store.joinRoom(room1.code, 'desktop', 'socket_d1', room1.desktopToken);
  store.joinRoom(room1.code, 'phone', 'socket_p1', room1.phoneToken);

  // Desktop switches to room2
  const switchResult = store.joinRoom(room2.code, 'desktop', 'socket_d1', room2.desktopToken);
  assert.equal(switchResult.success, true);
  assert.ok(switchResult.previousLeave);
  assert.equal(switchResult.previousLeave.otherPeerId, 'socket_p1');
  assert.equal(switchResult.previousLeave.role, 'desktop');

  store.dispose();
});

test('RoomStore - Liveness-based GC preserves active streaming rooms (N08, N43)', () => {
  const store = new RoomStore({ roomTtlMs: 60, abandonmentTtlMs: 50 });
  const room = store.createRoom();

  store.joinRoom(room.code, 'desktop', 'sock_d', room.desktopToken);
  store.joinRoom(room.code, 'phone', 'sock_p', room.phoneToken);

  // Keep touching room to simulate live WebRTC stream
  return new Promise((resolve) => {
    const keepAliveInterval = setInterval(() => {
      store.touchRoom(room.code);
    }, 20);

    setTimeout(() => {
      store.sweep();
      assert.ok(store.getRoom(room.code));
      clearInterval(keepAliveInterval);

      // Now stop touching and wait for TTL to expire
      setTimeout(() => {
        let swept = false;
        store.sweep((sockId) => {
          swept = true;
        });
        assert.equal(store.getRoom(room.code), null);
        assert.equal(swept, true);
        store.dispose();
        resolve();
      }, 80);
    }, 60);
  });
});
