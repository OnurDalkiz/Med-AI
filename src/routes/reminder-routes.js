const express = require('express');
const router = express.Router();
const db = require('../database');

// Hatırlatıcı listele (hasta bazında)
router.get('/:patientId', (req, res) => {
  const reminders = db.prepare(
    'SELECT * FROM reminders WHERE patient_id = ? AND active = 1 ORDER BY reminder_date ASC, reminder_time ASC'
  ).all(req.params.patientId);
  res.json(reminders);
});

// Yeni hatırlatıcı ekle
router.post('/', (req, res) => {
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
router.put('/:id', (req, res) => {
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
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('UPDATE reminders SET active = 0 WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
