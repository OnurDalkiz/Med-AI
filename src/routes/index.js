const express = require('express');
const router = express.Router();

const aiRoutes = require('./ai-routes');
const chatRoutes = require('./chat-routes');
const patientRoutes = require('./patient-routes');
const medicalRoutes = require('./medical-routes');
const reminderRoutes = require('./reminder-routes');
const calendarRoutes = require('./calendar-routes');
const enabizRoutes = require('./enabiz-routes');

router.use('/ai', aiRoutes);
router.use('/chat', chatRoutes);
router.use('/patients', patientRoutes);
router.use('/patient', patientRoutes);  // /patient/:id/summary backward compat
router.use('/', medicalRoutes);         // /events/:id, /labs/:id, /medications/:id, /upload, /files/:id
router.use('/reminders', reminderRoutes);
router.use('/calendar', calendarRoutes);
router.use('/enabiz', enabizRoutes);

module.exports = router;
