const express = require('express');
const router = express.Router();
const db = require('../database');
const { chat } = require('../ai-engine');
const { asyncHandler } = require('../middleware');

router.post('/', asyncHandler(async (req, res) => {
  const { patientId, message } = req.body;
  if (!patientId || !message) return res.status(400).json({ error: 'patientId ve message gerekli' });

  const reply = await chat(patientId, message);
  res.json({ reply });
}));

router.get('/history/:patientId', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const messages = db.prepare(
    'SELECT id, role, content, created_at FROM chat_history WHERE patient_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.params.patientId, limit).reverse();
  res.json(messages);
});

router.delete('/history/:patientId', (req, res) => {
  db.prepare('DELETE FROM chat_history WHERE patient_id = ?').run(req.params.patientId);
  res.json({ success: true });
});

module.exports = router;
