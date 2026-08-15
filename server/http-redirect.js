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
    
    // Replace HTTP_PORT with HTTPS PORT in host header if explicitly present
    let targetHost = hostHeader;
    if (targetHost.includes(`:${config.HTTP_PORT}`)) {
      targetHost = targetHost.replace(`:${config.HTTP_PORT}`, config.PORT === 443 ? '' : `:${config.PORT}`);
    } else if (!targetHost.includes(':') && config.PORT !== 443) {
      targetHost = `${targetHost}:${config.PORT}`;
    }

    const redirectUrl = `https://${targetHost}${req.url}`;
    res.redirect(301, redirectUrl);
  });

  const server = http.createServer(app);
  return server;
}

module.exports = {
  createHttpRedirectServer
};
