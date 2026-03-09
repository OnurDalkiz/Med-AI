require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./database');
const routes = require('./routes');
const { seedPatient } = require('./seed');
const ENabizScraper = require('./enabiz-scraper');
const { runChecks, runHourlyChecks } = require('./notification-service');

const app = express();
const PORT = process.env.PORT || 3200;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', routes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// İlk çalıştırmada hasta verisini seed'le
seedPatient();

// Hatırlatıcı kontrolü - her dakika
cron.schedule('* * * * *', () => {
  runChecks();
});

// Saatlik kontroller (anormal tahlil, yarınki randevu)
cron.schedule('0 * * * *', () => {
  runHourlyChecks();
});
console.log('🔔 Bildirim sistemi aktif (dakikada bir kontrol)');

// E-Nabız otomatik senkronizasyon (cron)
const syncInterval = parseInt(process.env.ENABIZ_SYNC_INTERVAL) || 0;
if (syncInterval > 0 && process.env.ENABIZ_TC && process.env.ENABIZ_PASSWORD) {
  const cronExpr = `0 */${syncInterval} * * *`;
  cron.schedule(cronExpr, async () => {
    console.log(`\n🔄 [CRON] E-Nabız otomatik senkronizasyon başlıyor...`);
    // Tüm hastaları senkronize et
    const patients = db.prepare('SELECT id, name, tc_no FROM patients WHERE tc_no IS NOT NULL').all();
    for (const patient of patients) {
      let scraper;
      try {
        scraper = new ENabizScraper(patient.id);
        await scraper.launch(true);
        const loggedIn = await scraper.login(patient.tc_no, process.env.ENABIZ_PASSWORD);
        if (loggedIn) {
          const result = await scraper.fetchAll();
          console.log(`✅ [CRON] ${patient.name} senkronize edildi`);
        } else {
          console.error(`❌ [CRON] ${patient.name} giriş başarısız`);
        }
      } catch (e) {
        console.error(`❌ [CRON] ${patient.name} hata:`, e.message);
      } finally {
        if (scraper) await scraper.close();
      }
    }
  });
  console.log(`⏰ E-Nabız otomatik senkronizasyon: Her ${syncInterval} saatte bir`);
} else {
  console.log(`ℹ️  E-Nabız otomatik senkronizasyon kapalı (ENABIZ_TC/PASSWORD ayarlanmamış)`);
}

app.listen(PORT, () => {
  const patients = db.prepare('SELECT name, diagnosis FROM patients').all();
  console.log(`\n🩺 MedAI Doktor Bot çalışıyor: http://localhost:${PORT}`);
  console.log(`👥 Kayıtlı hasta sayısı: ${patients.length}`);
  patients.forEach(p => console.log(`   📋 ${p.name} - ${p.diagnosis || 'Tanı belirtilmemiş'}`));
  console.log(`💬 Chat arayüzü hazır\n`);
});
