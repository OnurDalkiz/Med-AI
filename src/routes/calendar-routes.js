const express = require('express');
const router = express.Router();
const db = require('../database');

// Ay bazında tüm olayları getir (takvim için)
router.get('/:patientId/:year/:month', (req, res) => {
  const { patientId, year, month } = req.params;
  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const endDate = `${year}-${monthStr}-31`;

  const events = db.prepare(
    'SELECT id, event_date, event_type, title, description FROM medical_events WHERE patient_id = ? AND event_date BETWEEN ? AND ? ORDER BY event_date'
  ).all(patientId, startDate, endDate);

  const labs = db.prepare(
    'SELECT id, test_date, test_name, test_value, unit, is_abnormal FROM lab_results WHERE patient_id = ? AND test_date BETWEEN ? AND ? ORDER BY test_date'
  ).all(patientId, startDate, endDate);

  const meds = db.prepare(
    'SELECT id, name, dosage, start_date, end_date FROM medications WHERE patient_id = ? AND start_date BETWEEN ? AND ?'
  ).all(patientId, startDate, endDate);

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

module.exports = router;
