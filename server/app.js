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
  app.set('trust proxy', 1);

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

  // Global Error Handler
  app.use((err, req, res, next) => {
    logger.error(`Unhandled request error: ${err.message}`, { stack: err.stack });
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

module.exports = {
  createApp
};
