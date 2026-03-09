const express = require('express');
const router = express.Router();
const db = require('../database');
const enabizManager = require('../enabiz-manager');

// Tüm hastaları listele
router.get('/', (req, res) => {
  const patients = db.prepare('SELECT * FROM patients ORDER BY id ASC').all();
  res.json(patients);
});

// Yeni hasta ekle
router.post('/', (req, res) => {
  const { name, tcNo, gender, diagnosis, diagnosisDate, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Hasta adı gerekli' });

  const result = db.prepare(
    'INSERT INTO patients (name, tc_no, gender, diagnosis, diagnosis_date, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, tcNo || null, gender || null, diagnosis || null, diagnosisDate || null, notes || null);

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);
  res.json(patient);
});

// Hasta güncelle
router.put('/:id', (req, res) => {
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

// Hasta sil — FIX: silmeden ÖNCE yanıtı hazırla
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Hasta bulunamadı' });

  // E-Nabız bağlantısını kapat
  await enabizManager.disconnect(id).catch(() => {});

  // İlişkili verileri sil
  db.prepare('DELETE FROM chat_history WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM medical_events WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM lab_results WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM medications WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM uploaded_files WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM reminders WHERE patient_id = ?').run(id);
  db.prepare('DELETE FROM patients WHERE id = ?').run(id);

  res.json({ success: true, deleted: existing.name });
});

// Hasta özeti
router.get('/:id/summary', (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Hasta bulunamadı' });

  const eventCount = db.prepare('SELECT COUNT(*) as c FROM medical_events WHERE patient_id = ?').get(req.params.id).c;
  const labCount = db.prepare('SELECT COUNT(*) as c FROM lab_results WHERE patient_id = ?').get(req.params.id).c;
  const medCount = db.prepare('SELECT COUNT(*) as c FROM medications WHERE patient_id = ? AND active = 1').get(req.params.id).c;
  const lastEvent = db.prepare('SELECT * FROM medical_events WHERE patient_id = ? ORDER BY event_date DESC LIMIT 1').get(req.params.id);

  res.json({ patient, stats: { eventCount, labCount, medCount }, lastEvent });
});

module.exports = router;
