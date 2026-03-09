const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../database');
const { UPLOADS_DIR, MAX_UPLOAD_SIZE, ALLOWED_MIMETYPES } = require('../config');

// Upload config
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Desteklenmeyen dosya formatı'));
  }
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

module.exports = router;
