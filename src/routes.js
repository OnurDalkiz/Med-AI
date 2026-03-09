const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const db = require('./database');
const { chat, PROVIDERS, getConfig, saveConfig, validateKey } = require('./ai-engine');
const ENabizScraper = require('./enabiz-scraper');

const router = express.Router();

// E-Nabız scraper instances (per-patient)
const enabizScrapers = new Map(); // patientId -> scraper
const enabizStatuses = new Map(); // patientId -> status

function getEnabizStatus(patientId) {
  return enabizStatuses.get(patientId) || { state: 'idle', lastSync: null, error: null };
}

// File upload config
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'text/plain', 'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Desteklenmeyen dosya formatı'));
  }
});

// ========== AI YAPILANDIRMA ==========

// Mevcut durumu getir (API key maskelenmiş)
router.get('/ai/config', (req, res) => {
  const config = getConfig();
  res.json({
    configured: !!config,
    provider: config?.provider || null,
    model: config?.model || null,
    apiKeyHint: config?.apiKey ? config.apiKey.substring(0, 8) + '...' + config.apiKey.slice(-4) : null
  });
});

// Provider listesi
router.get('/ai/providers', (req, res) => {
  res.json(PROVIDERS);
});

// API key kaydet ve doğrula
router.post('/ai/config', async (req, res) => {
  const { provider, model, apiKey } = req.body;
  if (!provider || !model || !apiKey) {
    return res.status(400).json({ error: 'provider, model ve apiKey gerekli' });
  }
  if (!PROVIDERS[provider]) {
    return res.status(400).json({ error: 'Geçersiz provider. Desteklenen: openai, anthropic, google' });
  }
  // Custom model desteği: listedeki modeller dışında da kabul et

  // Key doğrula
  const validation = await validateKey(provider, apiKey, model);
  if (!validation.valid) {
    return res.status(400).json({ error: 'API key geçersiz: ' + validation.error });
  }

  // Kaydet
  saveConfig({ provider, model, apiKey });
  res.json({ success: true, message: 'AI yapılandırması kaydedildi' });
});

// ========== HASTA ==========

// Tüm hastaları listele
router.get('/patients', (req, res) => {
  const patients = db.prepare('SELECT * FROM patients ORDER BY id ASC').all();
  res.json(patients);
});

// Yeni hasta ekle
router.post('/patients', (req, res) => {
  const { name, tcNo, gender, diagnosis, diagnosisDate, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Hasta adı gerekli' });

  const result = db.prepare(
    'INSERT INTO patients (name, tc_no, gender, diagnosis, diagnosis_date, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, tcNo || null, gender || null, diagnosis || null, diagnosisDate || null, notes || null);

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);
  res.json(patient);
});

// Hasta güncelle
router.put('/patients/:id', (req, res) => {
  const { name, tcNo, gender, diagnosis, diagnosisDate, notes } = req.body;
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Hasta bulunamadı' });

  db.prepare(
    'UPDATE patients SET name = ?, tc_no = ?, gender = ?, diagnosis = ?, diagnosis_date = ?, notes = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
  ).run(
    name || existing.name,
    tcNo !== undefined ? tcNo : existing.tc_no,
    gender || existing.gender,
    diagnosis !== undefined ? diagnosis : existing.diagnosis,
    diagnosisDate || existing.diagnosis_date,
    notes !== undefined ? notes : existing.notes,
    id
  );

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  res.json(patient);
});

// Hasta sil
router.delete('/patients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Hasta bulunamadı' });

  // İlişkili verileri de sil
  db.prepare('DELETE FROM chat_history WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM medical_events WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM lab_results WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM medications WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM uploaded_files WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM reminders WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM patients WHERE id = ?').run(id);

  // E-Nabız bağlantısını da kapat
  const scraper = enabizScrapers.get(id);
  if (scraper) {
    scraper.close().catch(() => {});
    enabizScrapers.delete(id);
    enabizStatuses.delete(id);
  }

  res.json({ success: true });
});

router.get('/patient/:id', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Hasta bulunamadı' });
  res.json(patient);
});

router.get('/patient/:id/summary', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Hasta bulunamadı' });

  const eventCount = db.prepare('SELECT COUNT(*) as c FROM medical_events WHERE patient_id = ?').get(req.params.id).c;
  const labCount = db.prepare('SELECT COUNT(*) as c FROM lab_results WHERE patient_id = ?').get(req.params.id).c;
  const medCount = db.prepare('SELECT COUNT(*) as c FROM medications WHERE patient_id = ? AND active = 1').get(req.params.id).c;
  const lastEvent = db.prepare('SELECT * FROM medical_events WHERE patient_id = ? ORDER BY event_date DESC LIMIT 1').get(req.params.id);

  res.json({ patient, stats: { eventCount, labCount, medCount }, lastEvent });
});

// ========== CHAT ==========
router.post('/chat', async (req, res) => {
  const { patientId, message } = req.body;
  if (!patientId || !message) return res.status(400).json({ error: 'patientId ve message gerekli' });

  try {
    const reply = await chat(patientId, message);
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'AI yanıt üretemedi: ' + err.message });
  }
});

router.get('/chat/history/:patientId', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const messages = db.prepare(
    'SELECT id, role, content, created_at FROM chat_history WHERE patient_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.params.patientId, limit).reverse();
  res.json(messages);
});

router.delete('/chat/history/:patientId', (req, res) => {
  db.prepare('DELETE FROM chat_history WHERE patient_id = ?').run(req.params.patientId);
  res.json({ success: true });
});

// ========== TIBBİ OLAYLAR ==========
router.get('/events/:patientId', (req, res) => {
  const events = db.prepare(
    'SELECT * FROM medical_events WHERE patient_id = ? ORDER BY event_date DESC'
  ).all(req.params.patientId);
  res.json(events);
});

router.post('/events', (req, res) => {
  const { patientId, eventDate, eventType, title, description, data, source } = req.body;
  if (!patientId || !eventDate || !eventType || !title) {
    return res.status(400).json({ error: 'patientId, eventDate, eventType ve title gerekli' });
  }
  const result = db.prepare(
    'INSERT INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(patientId, eventDate, eventType, title, description, JSON.stringify(data || null), source || 'manual');
  res.json({ id: result.lastInsertRowid });
});

// ========== TAHLİL SONUÇLARI ==========
router.get('/labs/:patientId', (req, res) => {
  const labs = db.prepare(
    'SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC'
  ).all(req.params.patientId);
  res.json(labs);
});

router.post('/labs', (req, res) => {
  const { patientId, testDate, testName, testValue, unit, referenceRange, isAbnormal, category, source } = req.body;
  if (!patientId || !testDate || !testName) {
    return res.status(400).json({ error: 'patientId, testDate ve testName gerekli' });
  }
  const result = db.prepare(
    'INSERT INTO lab_results (patient_id, test_date, test_name, test_value, unit, reference_range, is_abnormal, category, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(patientId, testDate, testName, testValue, unit, referenceRange, isAbnormal ? 1 : 0, category, source || 'manual');
  res.json({ id: result.lastInsertRowid });
});

// ========== İLAÇLAR ==========
router.get('/medications/:patientId', (req, res) => {
  const meds = db.prepare(
    'SELECT * FROM medications WHERE patient_id = ? ORDER BY active DESC, start_date DESC'
  ).all(req.params.patientId);
  res.json(meds);
});

router.post('/medications', (req, res) => {
  const { patientId, name, dosage, frequency, startDate, endDate, prescribedBy, notes } = req.body;
  if (!patientId || !name) return res.status(400).json({ error: 'patientId ve name gerekli' });
  const result = db.prepare(
    'INSERT INTO medications (patient_id, name, dosage, frequency, start_date, end_date, prescribed_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(patientId, name, dosage, frequency, startDate, endDate, prescribedBy, notes);
  res.json({ id: result.lastInsertRowid });
});

// ========== DOSYA YÜKLEME ==========
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi' });
  const { patientId, fileType } = req.body;
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  const result = db.prepare(
    'INSERT INTO uploaded_files (patient_id, filename, original_name, mime_type, file_path, file_type) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(patientId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.path, fileType || 'other');

  res.json({ id: result.lastInsertRowid, filename: req.file.filename });
});

router.get('/files/:patientId', (req, res) => {
  const files = db.prepare(
    'SELECT * FROM uploaded_files WHERE patient_id = ? ORDER BY upload_date DESC'
  ).all(req.params.patientId);
  res.json(files);
});

// ========== HATIRLATICILAR / RANDEVULAR ==========

// Hatırlatıcı listele (hasta bazında)
router.get('/reminders/:patientId', (req, res) => {
  const reminders = db.prepare(
    'SELECT * FROM reminders WHERE patient_id = ? AND active = 1 ORDER BY reminder_date ASC, reminder_time ASC'
  ).all(req.params.patientId);
  res.json(reminders);
});

// Yeni hatırlatıcı ekle
router.post('/reminders', (req, res) => {
  const { patientId, title, description, reminderType, reminderDate, reminderTime, repeatType } = req.body;
  if (!patientId || !title || !reminderDate || !reminderTime) {
    return res.status(400).json({ error: 'patientId, title, reminderDate ve reminderTime gerekli' });
  }
  const result = db.prepare(
    'INSERT INTO reminders (patient_id, title, description, reminder_type, reminder_date, reminder_time, repeat_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(patientId, title, description || null, reminderType || 'custom', reminderDate, reminderTime, repeatType || 'none');
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(result.lastInsertRowid);
  res.json(reminder);
});

// Hatırlatıcı güncelle
router.put('/reminders/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Hatırlatıcı bulunamadı' });

  const { title, description, reminderType, reminderDate, reminderTime, repeatType } = req.body;
  db.prepare(
    'UPDATE reminders SET title = ?, description = ?, reminder_type = ?, reminder_date = ?, reminder_time = ?, repeat_type = ?, notified = 0 WHERE id = ?'
  ).run(
    title || existing.title,
    description !== undefined ? description : existing.description,
    reminderType || existing.reminder_type,
    reminderDate || existing.reminder_date,
    reminderTime || existing.reminder_time,
    repeatType !== undefined ? repeatType : existing.repeat_type,
    id
  );
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  res.json(reminder);
});

// Hatırlatıcı sil (soft delete)
router.delete('/reminders/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('UPDATE reminders SET active = 0 WHERE id = ?').run(id);
  res.json({ success: true });
});

// ========== TAKVİM ==========

// Ay bazında tüm olayları getir (takvim için)
router.get('/calendar/:patientId/:year/:month', (req, res) => {
  const { patientId, year, month } = req.params;
  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const endDate = `${year}-${monthStr}-31`;

  // Tıbbi olaylar
  const events = db.prepare(
    'SELECT id, event_date, event_type, title, description FROM medical_events WHERE patient_id = ? AND event_date BETWEEN ? AND ? ORDER BY event_date'
  ).all(patientId, startDate, endDate);

  // Tahlil sonuçları (tarih bazında gruplanmış)
  const labs = db.prepare(
    'SELECT id, test_date, test_name, test_value, unit, is_abnormal FROM lab_results WHERE patient_id = ? AND test_date BETWEEN ? AND ? ORDER BY test_date'
  ).all(patientId, startDate, endDate);

  // İlaç başlangıçları
  const meds = db.prepare(
    'SELECT id, name, dosage, start_date, end_date FROM medications WHERE patient_id = ? AND start_date BETWEEN ? AND ?'
  ).all(patientId, startDate, endDate);

  // Hatırlatıcılar
  const reminders = db.prepare(
    'SELECT id, title, description, reminder_type, reminder_date, reminder_time FROM reminders WHERE patient_id = ? AND active = 1 AND reminder_date BETWEEN ? AND ?'
  ).all(patientId, startDate, endDate);

  // Gün bazında grupla
  const days = {};
  for (const e of events) {
    const day = e.event_date.slice(0, 10);
    if (!days[day]) days[day] = [];
    days[day].push({ type: 'event', id: e.id, eventType: e.event_type, title: e.title, description: e.description });
  }
  for (const l of labs) {
    const day = l.test_date.slice(0, 10);
    if (!days[day]) days[day] = [];
    days[day].push({ type: 'lab', id: l.id, title: l.test_name, value: `${l.test_value} ${l.unit || ''}`, isAbnormal: l.is_abnormal });
  }
  for (const m of meds) {
    const day = m.start_date.slice(0, 10);
    if (!days[day]) days[day] = [];
    days[day].push({ type: 'medication', id: m.id, title: m.name, value: m.dosage });
  }
  for (const r of reminders) {
    const day = r.reminder_date.slice(0, 10);
    if (!days[day]) days[day] = [];
    days[day].push({ type: 'reminder', id: r.id, reminderType: r.reminder_type, title: r.title, description: r.description, time: r.reminder_time });
  }

  res.json(days);
});

// ========== TEKİL KAYIT DETAY ==========
router.get('/event/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM medical_events WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  res.json(row);
});

router.get('/lab/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM lab_results WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  res.json(row);
});

router.get('/medication/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM medications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  res.json(row);
});

router.get('/reminder/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  res.json(row);
});

// ========== E-NABIZ ENTEGRASYONU ==========

// E-Nabız durumu (per-patient)
router.get('/enabiz/status/:patientId', (req, res) => {
  const patientId = parseInt(req.params.patientId);
  const status = getEnabizStatus(patientId);
  const scraper = enabizScrapers.get(patientId);
  res.json({
    ...status,
    isRunning: !!scraper && scraper.isLoggedIn
  });
});

// Manuel giriş (tarayıcı açılır, kullanıcı kendisi giriş yapar)
router.post('/enabiz/manual-login', async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  try {
    const prevStatus = getEnabizStatus(patientId);
    enabizStatuses.set(patientId, { state: 'logging-in', lastSync: prevStatus.lastSync, error: null });

    const existing = enabizScrapers.get(patientId);
    if (existing) await existing.close();

    const scraper = new ENabizScraper(patientId);
    await scraper.launch(false);
    enabizScrapers.set(patientId, scraper);

    const success = await scraper.manualLogin();
    if (success) {
      enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'connected' });
      res.json({ success: true, message: 'E-Nabız giriş başarılı' });
    } else {
      enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'error', error: 'Giriş zaman aşımı' });
      res.status(408).json({ success: false, error: 'Giriş zaman aşımı' });
    }
  } catch (e) {
    enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'error', error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
});

// Otomatik giriş (TC + şifre ile)
router.post('/enabiz/login', async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  try {
    const tc = req.body.tc;
    const password = req.body.password;
    if (!tc || !password) return res.status(400).json({ error: 'TC ve şifre gerekli' });

    const prevStatus = getEnabizStatus(patientId);
    enabizStatuses.set(patientId, { state: 'logging-in', lastSync: prevStatus.lastSync, error: null });

    const existing = enabizScrapers.get(patientId);
    if (existing) await existing.close();

    const scraper = new ENabizScraper(patientId);
    await scraper.launch(false);
    enabizScrapers.set(patientId, scraper);

    const success = await scraper.login(tc, password);
    if (success) {
      enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'connected' });
      res.json({ success: true, message: 'E-Nabız giriş başarılı' });
    } else {
      enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'error', error: 'Giriş başarısız' });
      res.status(401).json({ success: false, error: 'Giriş başarısız - Captcha/SMS doğrulaması gerekebilir' });
    }
  } catch (e) {
    enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'error', error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
});

// Veri çek (tüm verileri veya belirli türü)
router.post('/enabiz/fetch', async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  try {
    const scraper = enabizScrapers.get(patientId);
    if (!scraper || !scraper.isLoggedIn) {
      return res.status(401).json({ error: 'Önce E-Nabız giriş yapın' });
    }

    const type = req.body.type || 'all';
    enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'syncing' });

    let result;
    switch (type) {
      case 'labs': result = await scraper.fetchLabResults(); break;
      case 'prescriptions': result = await scraper.fetchPrescriptions(); break;
      case 'visits': result = await scraper.fetchVisitHistory(); break;
      case 'radiology': result = await scraper.fetchRadiology(); break;
      case 'epicrisis': result = await scraper.fetchEpikriz(); break;
      case 'reports': result = await scraper.fetchReports(); break;
      case 'allergies': result = await scraper.fetchAllergies(); break;
      case 'vaccines': result = await scraper.fetchVaccines(); break;
      case 'chronic': result = await scraper.fetchChronicDiseases(); break;
      case 'surgeries': result = await scraper.fetchSurgeries(); break;
      case 'diagnoses': result = await scraper.fetchDiagnoses(); break;
      default: result = await scraper.fetchAll();
    }

    const lastSync = new Date().toISOString();
    enabizStatuses.set(patientId, { state: 'connected', lastSync, error: null });
    res.json({ success: true, type, result, lastSync });
  } catch (e) {
    enabizStatuses.set(patientId, { ...getEnabizStatus(patientId), state: 'error', error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
});

// Tarayıcıyı kapat
router.post('/enabiz/disconnect', async (req, res) => {
  const patientId = parseInt(req.body.patientId);
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli' });

  try {
    const scraper = enabizScrapers.get(patientId);
    if (scraper) {
      await scraper.close();
      enabizScrapers.delete(patientId);
    }
    const prevStatus = getEnabizStatus(patientId);
    enabizStatuses.set(patientId, { state: 'idle', lastSync: prevStatus.lastSync, error: null });
    res.json({ success: true, message: 'E-Nabız bağlantısı kapatıldı' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
