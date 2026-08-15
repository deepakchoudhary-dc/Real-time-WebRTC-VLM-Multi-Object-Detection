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

  // Attach WebRTC Signaling handlers
  attachSignaling(io);

  // Start HTTP Redirect Server
  const redirectServer = createHttpRedirectServer();
  if (redirectServer) {
    redirectServer.listen(config.HTTP_PORT, '0.0.0.0', () => {
      logger.info(`HTTP -> HTTPS redirect listening on port ${config.HTTP_PORT}`);
    });
  }

  // Start HTTPS Server
  httpsServer.listen(config.PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🚀 WebRTC Object Detection Server v2.1.0');
    console.log('═'.repeat(55));
    console.log(`🔒 HTTPS Desktop:  https://localhost:${config.PORT}`);
    console.log(`📱 Phone Stream:   https://${primaryLANIP}:${config.PORT}/phone`);
    console.log(`🌐 Primary LAN IP: ${primaryLANIP}`);
    console.log(`📡 Listening on:   0.0.0.0:${config.PORT}`);
    console.log('═'.repeat(55));
    console.log('💡 Accept the self-signed certificate warning once in your browser.');
    console.log('');
  });

  // Graceful Shutdown
  function shutdown(signal) {
    logger.info(`${signal} received. Commencing graceful shutdown...`);

    // Disconnect all active sockets
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

  return { httpsServer, redirectServer, io, app };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer
};
