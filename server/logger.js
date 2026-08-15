'use strict';

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const currentLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LOG_LEVELS[currentLevel] || LOG_LEVELS.info;

function maskCode(code) {
  if (!code || typeof code !== 'string') return '******';
  return code.slice(0, 2) + '****';
}

function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  
  // Redact sensitive keys if present (F-19)
  const safeMeta = { ...meta };
  if (safeMeta.token) safeMeta.token = '[REDACTED]';
  if (safeMeta.secret) safeMeta.secret = '[REDACTED]';
  if (safeMeta.credential) safeMeta.credential = '[REDACTED]';
  if (safeMeta.roomCode) safeMeta.roomCode = maskCode(safeMeta.roomCode);
  if (safeMeta.code) safeMeta.code = maskCode(safeMeta.code);

  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify({
      time: timestamp,
      level,
      msg: message,
      ...safeMeta
    });
  }

  const metaStr = Object.keys(safeMeta).length > 0 ? ` ${JSON.stringify(safeMeta)}` : '';
  const prefixMap = {
    debug: '🔍 DEBUG',
    info: 'ℹ️ INFO ',
    warn: '⚠️ WARN ',
    error: '❌ ERROR'
  };
  return `[${timestamp}] ${prefixMap[level] || level}: ${message}${metaStr}`;
}

const logger = {
  maskCode,
  debug(msg, meta) {
    if (threshold <= LOG_LEVELS.debug) {
      console.log(formatLog('debug', msg, meta));
    }
  },
  info(msg, meta) {
    if (threshold <= LOG_LEVELS.info) {
      console.log(formatLog('info', msg, meta));
    }
  },
  warn(msg, meta) {
    if (threshold <= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', msg, meta));
    }
  },
  error(msg, meta) {
    if (threshold <= LOG_LEVELS.error) {
      console.error(formatLog('error', msg, meta));
    }
  }
};

module.exports = logger;
