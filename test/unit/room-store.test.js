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

test('RoomStore - Constant-Time Token Authentication & Token TTL (N05, R10, R11)', () => {
  const store = new RoomStore({ maxRooms: 10, tokenTtlMs: 100 });
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

  // 6. Token TTL expiry check (R10)
  return new Promise((resolve) => {
    setTimeout(() => {
      const expiredJoin = store.joinRoom(room.code, 'desktop', 'socket_d_late', room.desktopToken);
      assert.equal(expiredJoin.success, false);
      assert.match(expiredJoin.error, /expired/i);
      store.dispose();
      resolve();
    }, 120);
  });
});

test('RoomStore - Idempotent Join (H1)', () => {
  const store = new RoomStore({ maxRooms: 10 });
  const room = store.createRoom();

  // Initial join
  const res1 = store.joinRoom(room.code, 'desktop', 'socket_d1', room.desktopToken);
  assert.equal(res1.success, true);
  assert.equal(res1.previousLeave, null);

  // Re-joining same room and role with same socket -> Idempotent no-op (no previousLeave)
  const res2 = store.joinRoom(room.code, 'desktop', 'socket_d1', room.desktopToken);
  assert.equal(res2.success, true);
  assert.equal(res2.previousLeave, null);
  assert.equal(room.desktop, 'socket_d1');

  store.dispose();
});

test('RoomStore - Authoritative Same-Token Reclaim and SocketMap Cleanup (P19, H4, G08, N09)', () => {
  const store = new RoomStore({ maxRooms: 10 });
  const room = store.createRoom();

  store.joinRoom(room.code, 'desktop', 'socket_d1_old', room.desktopToken);
  assert.equal(room.desktop, 'socket_d1_old');
  assert.ok(store.socketMap.has('socket_d1_old'));

  // Reconnecting desktop joins with socket_d2_new presenting the same authoritative desktopToken
  const reclaim = store.joinRoom(room.code, 'desktop', 'socket_d2_new', room.desktopToken);
  assert.equal(reclaim.success, true);
  assert.equal(room.desktop, 'socket_d2_new');
  // Verified old socket mapping removed from socketMap (H4)
  assert.equal(store.socketMap.has('socket_d1_old'), false);
  assert.ok(store.socketMap.has('socket_d2_new'));

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

test('RoomStore - Never-joined room rapid sweep prevents room exhaustion (H13)', () => {
  const store = new RoomStore({ roomTtlMs: 5000, neverJoinedTtlMs: 40 });
  const roomUnused = store.createRoom();

  return new Promise((resolve) => {
    setTimeout(() => {
      store.sweep();
      // Unused room with zero joins swept in 40ms (H13)
      assert.equal(store.getRoom(roomUnused.code), null);
      store.dispose();
      resolve();
    }, 60);
  });
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
