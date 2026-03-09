const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

module.exports = {
  PORT: process.env.PORT || 3200,

  // Paths
  ROOT_DIR,
  DATA_DIR: path.join(ROOT_DIR, 'data'),
  UPLOADS_DIR: path.join(ROOT_DIR, 'uploads'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  DB_PATH: path.join(ROOT_DIR, 'data', 'medai.db'),
  AI_CONFIG_PATH: path.join(ROOT_DIR, 'data', 'ai-config.json'),

  // E-Nabız
  ENABIZ_BASE_URL: 'https://enabiz.gov.tr',
  KEEP_ALIVE_INTERVAL: 10 * 60 * 1000, // 10 dakika
  LOGIN_TIMEOUT: 10 * 60 * 1000, // 10 dakika

  // Upload limits
  MAX_UPLOAD_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_JSON_SIZE: '10mb',

  // Chat
  CHAT_HISTORY_LIMIT: 20,
  CHAT_FETCH_LIMIT: 200,

  // Notifications
  APP_NAME: 'MedAI Doktor Bot',
  CRITICAL_KEYWORDS: ['kanser', 'tümör', 'metastaz', 'malign', 'karsinom', 'sarkom', 'lösemi', 'lenfoma'],

  // Allowed upload mimetypes
  ALLOWED_MIMETYPES: [
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'text/plain', 'application/json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
};
