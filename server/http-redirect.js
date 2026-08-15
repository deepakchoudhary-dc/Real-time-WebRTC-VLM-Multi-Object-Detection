'use strict';

const express = require('express');
const http = require('http');
const config = require('./config');
const logger = require('./logger');
const { getValidHost } = require('./security');

function createHttpRedirectServer() {
  if (config.HTTP_PORT === config.PORT) {
    logger.warn('HTTP_PORT and PORT are the same. Skipping HTTP redirect server.');
    return null;
  }

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res) => {
    const validHost = getValidHost(req);
    const hostHeader = validHost || 'localhost';
    
    // Clean hostname extraction without substring replace bugs (N11, F-16)
    const hostname = hostHeader.split(':')[0];
    const portPart = config.PORT === 443 ? '' : `:${config.PORT}`;

    const redirectUrl = `https://${hostname}${portPart}${req.url}`;
    res.redirect(301, redirectUrl);
  });

  const server = http.createServer(app);
  return server;
}

module.exports = {
  createHttpRedirectServer
};
