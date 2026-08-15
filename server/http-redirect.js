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
    
    // IPv4 & IPv6 bracket-safe hostname extraction (G06, R14)
    let hostname = 'localhost';
    if (hostHeader.startsWith('[')) {
      const closeBracket = hostHeader.indexOf(']');
      if (closeBracket !== -1) {
        hostname = hostHeader.slice(0, closeBracket + 1); // Keep brackets for IPv6 URL
      }
    } else if (hostHeader.includes(':')) {
      hostname = hostHeader.split(':')[0];
    } else {
      hostname = hostHeader;
    }

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
