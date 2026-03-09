const express = require('express');
const router = express.Router();
const db = require('../database');
const enabizManager = require('../enabiz-manager');
const { checkPostSyncCriticals } = require('../notification-service');
const { asyncHandler } = require('../middleware');

// E-Nabız durumu (per-patient)
router.get('/status/:patientId', (req, res) => {
  const patientId = parseInt(req.params.patientId);
  const status = enabizManager.getStatus(patientId);
  res.json({
    ...status,
    isRunning: enabizManager.isConnected(patientId)
  });
});

// Manuel giriş (tarayıcı açılır, kullanıcı kendisi giriş yapar)
router.post('/manual-login', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  const success = await enabizManager.manualLogin(patientId);
  if (success) {
    res.json({ success: true, message: 'E-Nabız giriş başarılı' });
  } else {
    res.status(408).json({ success: false, error: 'Giriş zaman aşımı' });
  }
}));

// Otomatik giriş (TC + şifre ile)
router.post('/login', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  const { tc, password } = req.body;
  if (!tc || !password) return res.status(400).json({ error: 'TC ve şifre gerekli' });

  const success = await enabizManager.autoLogin(patientId, tc, password);
  if (success) {
    res.json({ success: true, message: 'E-Nabız giriş başarılı' });
  } else {
    res.status(401).json({ success: false, error: 'Giriş başarısız - Captcha/SMS doğrulaması gerekebilir' });
  }
}));

// Veri çek
router.post('/fetch', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  const type = req.body.type || 'all';
  const { result, syncStart, lastSync } = await enabizManager.fetchData(patientId, type);

  // Senkronizasyon sonrası kritik bulgu kontrolü
  checkPostSyncCriticals(patientId, syncStart);

  res.json({ success: true, type, result, lastSync });
}));

// Bağlantıyı kapat
router.post('/disconnect', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  await enabizManager.disconnect(patientId);
  res.json({ success: true, message: 'E-Nabız bağlantısı kapatıldı' });
}));

// Radyoloji görüntüsünü getir
router.get('/radiology-image/:patientId/:imageId', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.params.patientId);
  const imageId = req.params.imageId;
  if (!patientId || !imageId) return res.status(400).json({ error: 'patientId ve imageId gerekli' });

  // Önce DB'den thumbnail kontrol et
  try {
    const dbRow = db.prepare(
      "SELECT data FROM medical_events WHERE event_type='radiology' AND patient_id=? AND json_extract(data,'$.imageId')=?"
    ).get(patientId, imageId);
    if (dbRow) {
      const d = JSON.parse(dbRow.data || '{}');
      if (d.thumbnailData) {
        return res.json({ success: true, imageData: d.thumbnailData });
      }
    }
  } catch(e) { /* DB check failed, continue */ }

  const scraper = enabizManager.getScraper(patientId);
  if (!scraper || !scraper.isLoggedIn) {
    return res.status(400).json({ error: 'E-Nabız bağlantısı aktif değil. Önce giriş yapın.' });
  }

  const result = await scraper.getRadiologyImage(imageId);
  if (result && result.dataUrl) {
    res.json({ success: true, imageData: result.dataUrl });
  } else {
    res.json({ success: false, error: 'Görüntü alınamadı. E-Nabız üzerinden görüntülemeyi deneyin.' });
  }
}));

module.exports = router;
