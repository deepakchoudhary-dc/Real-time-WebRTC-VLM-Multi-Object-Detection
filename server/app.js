'use strict';

const path = require('path');
const express = require('express');
const { securityHeaders } = require('./security');
const { attachRoutes } = require('./routes');
const logger = require('./logger');

// Optional compression
let compression = null;
try {
  compression = require('compression');
} catch {
  // Compression optional
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // Secure trust proxy against spoofing (N31)

  // Compression if available
  if (compression) {
    app.use(compression());
  }

  // Security Headers (CSP, HSTS, X-Content-Type-Options, etc.)
  app.use(securityHeaders);

  // Body parser for JSON
  app.use(express.json({ limit: '64kb' }));

  // Static Assets from frontend/
  app.use(
    express.static(path.join(__dirname, '../frontend'), {
      maxAge: '1h',
      etag: true,
      index: false
    })
  );

  // Attach API and Page Routes
  attachRoutes(app);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global Error Handler (N33: handles malformed JSON with 400)
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Malformed JSON payload' });
    }
    logger.error(`Unhandled request error: ${err.message}`, { stack: err.stack });
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

module.exports = {
  createApp
};
