require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const { PORT, MAX_JSON_SIZE, PUBLIC_DIR } = require('./config');
const db = require('./database');
const logger = require('./logger');
const routes = require('./routes/index');
const { errorHandler } = require('./middleware');
const { seedPatient } = require('./seed');
const { runChecks, runHourlyChecks, checkPostSyncCriticals } = require('./notification-service');
const enabizManager = require('./enabiz-manager');

// ========== APP SETUP ==========
const app = express();
app.use(cors());
app.use(express.json({ limit: MAX_JSON_SIZE }));
app.use(express.static(PUBLIC_DIR));

// API routes
app.use('/api', routes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Error handling middleware (must be last)
app.use(errorHandler);

// ========== INITIALIZE ==========
seedPatient();

// ========== CRON JOBS ==========

// Hatırlatıcı kontrolü — her dakika
cron.schedule('* * * * *', () => runChecks());

// Saatlik kontroller (anormal tahlil, yarınki randevu)
cron.schedule('0 * * * *', () => runHourlyChecks());

// E-Nabız otomatik senkronizasyon — her saat
cron.schedule('0 * * * *', () => autoSync());

logger.info('CRON', 'Bildirim sistemi aktif (dakikada bir kontrol)');
logger.info('CRON', 'E-Nabız otomatik senkronizasyon: her saat başı');

// ========== AUTO-SYNC ==========
async function autoSync() {
  const connectedIds = enabizManager.getConnectedPatientIds();
  if (connectedIds.length === 0) return;

  logger.info('AUTO-SYNC', `${connectedIds.length} bağlı hasta için senkronizasyon başlıyor...`);

  for (const patientId of connectedIds) {
    const scraper = enabizManager.getScraper(patientId);
    if (!scraper || !scraper.isLoggedIn) continue;

    const patient = db.prepare('SELECT name FROM patients WHERE id = ?').get(patientId);
    const patientName = patient?.name || `Hasta #${patientId}`;

    try {
      const alive = await scraper.keepAlive();
      if (!alive) {
        logger.warn('AUTO-SYNC', `${patientName}: Oturum düşmüş, atlanıyor`);
        enabizManager.setStatus(patientId, { state: 'expired', error: 'Oturum düştü' });
        continue;
      }

      const { syncStart, lastSync } = await enabizManager.fetchData(patientId);
      logger.success('AUTO-SYNC', `${patientName}: Senkronizasyon tamamlandı`);
      checkPostSyncCriticals(patientId, syncStart);
    } catch (e) {
      logger.error('AUTO-SYNC', `${patientName}: Hata - ${e.message}`);
      enabizManager.setStatus(patientId, { state: 'error', error: e.message });
    }
  }

  logger.success('AUTO-SYNC', 'Saatlik senkronizasyon tamamlandı');
}

// ========== GRACEFUL SHUTDOWN ==========
let server;

async function shutdown(signal) {
  logger.info('SHUTDOWN', `${signal} alındı, kapatılıyor...`);

  // HTTP sunucusunu kapat
  if (server) {
    server.close(() => logger.info('SHUTDOWN', 'HTTP sunucusu kapatıldı'));
  }

  // E-Nabız bağlantılarını kapat
  await enabizManager.closeAll();

  // Veritabanını kapat
  try { db.close(); } catch (e) { /* already closed */ }
  logger.info('SHUTDOWN', 'Veritabanı kapatıldı');

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ========== START ==========
server = app.listen(PORT, () => {
  const patients = db.prepare('SELECT name, diagnosis FROM patients').all();
  console.log(`\n🩺 MedAI Doktor Bot çalışıyor: http://localhost:${PORT}`);
  console.log(`👥 Kayıtlı hasta sayısı: ${patients.length}`);
  patients.forEach(p => console.log(`   📋 ${p.name} - ${p.diagnosis || 'Tanı belirtilmemiş'}`));
  console.log(`💬 Chat arayüzü hazır\n`);
});
