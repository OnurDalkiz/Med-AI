const { APP_NAME } = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'];

function timestamp() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatMessage(icon, tag, msg) {
  return `${icon} [${timestamp()}] [${tag}] ${msg}`;
}

const logger = {
  debug(tag, msg) {
    if (currentLevel <= LEVELS.debug) console.log(formatMessage('🔍', tag, msg));
  },
  info(tag, msg) {
    if (currentLevel <= LEVELS.info) console.log(formatMessage('ℹ️', tag, msg));
  },
  warn(tag, msg) {
    if (currentLevel <= LEVELS.warn) console.warn(formatMessage('⚠️', tag, msg));
  },
  error(tag, msg, err) {
    if (currentLevel <= LEVELS.error) {
      console.error(formatMessage('❌', tag, msg));
      if (err?.stack) console.error(err.stack);
    }
  },
  success(tag, msg) {
    console.log(formatMessage('✅', tag, msg));
  },
  notify(msg) {
    console.log(`🔔 [${timestamp()}] ${msg}`);
  }
};

module.exports = logger;
