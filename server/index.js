'use strict';

const https = require('https');
const { Server: SocketIOServer } = require('socket.io');
const config = require('./config');
const logger = require('./logger');
const { generateCertificates } = require('./tls');
const { isOriginAllowed } = require('./security');
const { createApp } = require('./app');
const { attachSignaling } = require('./signaling');
const { createHttpRedirectServer } = require('./http-redirect');
const { roomStore } = require('./room-store');

function startServer() {
  const { key, cert, primaryLANIP } = generateCertificates();
  const app = createApp();

  // Create HTTPS Server
  const httpsServer = https.createServer({ key, cert }, app);

  // Initialize Socket.IO with strict CORS & Buffer limits
  const io = new SocketIOServer(httpsServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          logger.warn(`Blocked Socket.IO connection from disallowed origin: ${origin}`);
          callback(new Error('CORS: Origin not allowed'));
        }
      },
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: config.MAX_PAYLOAD_BYTES,
    pingTimeout: 20_000,
    pingInterval: 10_000
  });

  // Shared sweep notify callback for interval and overflow sweeps (G07)
  const handleRoomSweep = (socketId, roomCode) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('room-closed', { reason: 'Room expired due to inactivity' });
      socket.disconnect(true);
    }
  };

  roomStore.setSweepCallback(handleRoomSweep);

  // Enforce MAX_CONNECTIONS cap across ALL connected sockets (idle + joined, R05)
  io.use((socket, next) => {
    const totalClients = io.engine ? io.engine.clientsCount : roomStore.activeConnectionsCount;
    if (totalClients > config.MAX_CONNECTIONS) {
      logger.warn(`Rejected connection: MAX_CONNECTIONS (${config.MAX_CONNECTIONS}) reached.`);
      return next(new Error('Server full. Maximum connections reached.'));
    }
    next();
  });

  // Attach WebRTC Signaling handlers
  attachSignaling(io);

  // Single Owner GC timer (R06, N08)
  const gcTimer = setInterval(() => {
    roomStore.sweep(handleRoomSweep);
  }, config.ROOM_GC_INTERVAL_MS);
  if (gcTimer.unref) gcTimer.unref();

  // Start HTTP Redirect Server
  const redirectServer = createHttpRedirectServer();
  if (redirectServer) {
    redirectServer.listen(config.HTTP_PORT, '0.0.0.0', () => {
      logger.info(`HTTP -> HTTPS redirect listening on port ${config.HTTP_PORT}`);
    });
  }

  // Start HTTPS Server
  httpsServer.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`WebRTC Object Detection Server listening on 0.0.0.0:${config.PORT}`, {
      httpsUrl: `https://localhost:${config.PORT}`,
      phoneUrl: `https://${primaryLANIP}:${config.PORT}/phone`,
      lanIp: primaryLANIP
    });
  });

  // Graceful Shutdown
  function shutdown(signal) {
    logger.info(`${signal} received. Commencing graceful shutdown...`);

    clearInterval(gcTimer);

    io.close(() => {
      logger.info('Socket.IO connections closed.');
    });

    roomStore.dispose();

    httpsServer.close(() => {
      if (redirectServer) {
        redirectServer.close(() => {
          logger.info('Servers terminated cleanly.');
          process.exit(0);
        });
      } else {
        logger.info('Server terminated cleanly.');
        process.exit(0);
      }
    });

    // Force exit after 5s if still hanging
    setTimeout(() => {
      logger.error('Forcing process exit after shutdown timeout.');
      process.exit(1);
    }, 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { httpsServer, redirectServer, io, app, gcTimer };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer
};
