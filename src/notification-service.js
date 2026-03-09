const notifier = require('node-notifier');
const path = require('path');
const db = require('./database');
const { APP_NAME, CRITICAL_KEYWORDS, PUBLIC_DIR } = require('./config');
const logger = require('./logger');

function sendNotification(title, message, patientName) {
  const fullTitle = patientName ? `${APP_NAME} - ${patientName}` : APP_NAME;
  notifier.notify({
    title: fullTitle,
    message: message,
    icon: path.join(PUBLIC_DIR, 'icon.png'),
    appID: 'MedAI',
    sound: true,
    wait: false
  });
  logger.notify(`[${fullTitle}] ${message}`);
}

// Her dakika çalışacak: aktif hatırlatıcıları kontrol et
function checkReminders() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const currentTime = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false }); // HH:MM

  // Bugünün henüz bildirilmemiş hatırlatıcılarını bul
  const dueReminders = db.prepare(`
    SELECT r.*, p.name as patient_name
    FROM reminders r
    JOIN patients p ON r.patient_id = p.id
    WHERE r.active = 1
      AND r.notified = 0
      AND r.reminder_date = ?
      AND r.reminder_time <= ?
  `).all(today, currentTime);

  for (const reminder of dueReminders) {
    const typeLabels = {
      appointment: '📅 Randevu',
      medication: '💊 İlaç',
      checkup: '🔬 Kontrol',
      custom: '📌 Hatırlatma'
    };
    const typeLabel = typeLabels[reminder.reminder_type] || '📌 Hatırlatma';
    const msg = `${typeLabel}: ${reminder.title}${reminder.description ? '\n' + reminder.description : ''}`;

    sendNotification(typeLabel, msg, reminder.patient_name);

    // Tekrarlayan hatırlatıcıları bir sonraki tarihe taşı
    if (reminder.repeat_type && reminder.repeat_type !== 'none') {
      const nextDate = getNextDate(reminder.reminder_date, reminder.repeat_type);
      db.prepare('UPDATE reminders SET reminder_date = ?, notified = 0 WHERE id = ?')
        .run(nextDate, reminder.id);
    } else {
      db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?').run(reminder.id);
    }
  }

  return dueReminders.length;
}

// Anormal tahlil sonuçlarını kontrol et (son 1 saatte eklenenler)
function checkAbnormalLabs() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const abnormalLabs = db.prepare(`
    SELECT lr.*, p.name as patient_name
    FROM lab_results lr
    JOIN patients p ON lr.patient_id = p.id
    WHERE lr.is_abnormal = 1
      AND lr.created_at > ?
  `).all(oneHourAgo);

  // Gruplayarak bildirim gönder (patient başına tek bildirim)
  const grouped = {};
  for (const lab of abnormalLabs) {
    if (!grouped[lab.patient_id]) {
      grouped[lab.patient_id] = { name: lab.patient_name, labs: [] };
    }
    grouped[lab.patient_id].labs.push(lab);
  }

  for (const [, group] of Object.entries(grouped)) {
    const labNames = group.labs.map(l => `${l.test_name}: ${l.test_value} ${l.unit || ''}`).join(', ');
    sendNotification(
      '⚠️ Anormal Tahlil',
      `${group.labs.length} anormal sonuç: ${labNames}`,
      group.name
    );
  }

  return abnormalLabs.length;
}

// Yaklaşan randevuları kontrol et (yarın)
function checkUpcomingAppointments() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const upcoming = db.prepare(`
    SELECT r.*, p.name as patient_name
    FROM reminders r
    JOIN patients p ON r.patient_id = p.id
    WHERE r.active = 1
      AND r.reminder_type = 'appointment'
      AND r.reminder_date = ?
  `).all(tomorrow);

  for (const appt of upcoming) {
    sendNotification(
      '📅 Yarınki Randevu',
      `${appt.title} - Saat: ${appt.reminder_time}${appt.description ? '\n' + appt.description : ''}`,
      appt.patient_name
    );
  }

  return upcoming.length;
}

function getNextDate(dateStr, repeatType) {
  const date = new Date(dateStr);
  switch (repeatType) {
    case 'daily': date.setDate(date.getDate() + 1); break;
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
    default: return dateStr;
  }
  return date.toISOString().slice(0, 10);
}

// Ana kontrol fonksiyonu (her dakika çağrılacak)
function runChecks() {
  try {
    const remindersCount = checkReminders();
    if (remindersCount > 0) logger.info('NOTIFY', `${remindersCount} hatırlatıcı gönderildi`);
  } catch (e) {
    logger.error('NOTIFY', 'Reminder check error', e);
  }
}

// Saatlik kontroller (anormal tahlil, yarınki randevu)
function runHourlyChecks() {
  try {
    checkAbnormalLabs();
    checkUpcomingAppointments();
    checkTodayAppointments();
  } catch (e) {
    logger.error('NOTIFY', 'Hourly check error', e);
  }
}

// Bugünkü randevuları kontrol et
function checkTodayAppointments() {
  const today = new Date().toISOString().slice(0, 10);

  const todayEvents = db.prepare(`
    SELECT me.*, p.name as patient_name
    FROM medical_events me
    JOIN patients p ON me.patient_id = p.id
    WHERE me.event_type = 'appointment'
      AND me.event_date = ?
  `).all(today);

  for (const evt of todayEvents) {
    sendNotification(
      '📅 Bugünkü Randevu',
      `${evt.title}${evt.description ? '\n' + evt.description.substring(0, 150) : ''}`,
      evt.patient_name
    );
  }

  return todayEvents.length;
}

// Senkronizasyon sonrası kritik bulgu kontrolü — yeni eklenen lab/event'leri analiz et
function checkPostSyncCriticals(patientId, syncStartTime) {
  const patient = db.prepare('SELECT name FROM patients WHERE id = ?').get(patientId);
  if (!patient) return;

  const notifications = [];

  // 1. Yeni anormal tahliller (sync sırasında eklenmiş)
  const newAbnormalLabs = db.prepare(`
    SELECT * FROM lab_results
    WHERE patient_id = ? AND is_abnormal = 1 AND created_at > ?
  `).all(patientId, syncStartTime);

  if (newAbnormalLabs.length > 0) {
    const labList = newAbnormalLabs
      .slice(0, 5)
      .map(l => `${l.test_name}: ${l.test_value} ${l.unit || ''} (ref: ${l.reference_range || '?'})`)
      .join('\n');
    notifications.push({
      title: '⚠️ Anormal Tahlil Sonuçları',
      message: `${newAbnormalLabs.length} anormal sonuç:\n${labList}`
    });
  }

  // 2. Bugün veya yarınki randevular
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const upcomingAppts = db.prepare(`
    SELECT * FROM medical_events
    WHERE patient_id = ? AND event_type = 'appointment'
      AND event_date IN (?, ?)
  `).all(patientId, today, tomorrow);

  for (const appt of upcomingAppts) {
    const isToday = appt.event_date === today;
    notifications.push({
      title: isToday ? '📅 Bugünkü Randevu' : '📅 Yarınki Randevu',
      message: appt.title + (appt.description ? '\n' + appt.description.substring(0, 150) : '')
    });
  }

  // 3. Kritik tanılar (yeni eklenen)
  const newDiagnoses = db.prepare(`
    SELECT * FROM medical_events
    WHERE patient_id = ? AND event_type IN ('diagnosis', 'chronic_disease') AND created_at > ?
  `).all(patientId, syncStartTime);

  for (const diag of newDiagnoses) {
    const text = ((diag.title || '') + ' ' + (diag.description || '')).toLowerCase();
    if (CRITICAL_KEYWORDS.some(kw => text.includes(kw))) {
      notifications.push({
        title: '🚨 Kritik Tanı',
        message: diag.title
      });
    }
  }

  // Bildirimleri gönder
  for (const n of notifications) {
    sendNotification(n.title, n.message, patient.name);
  }

  if (notifications.length > 0) {
    logger.info('NOTIFY', `${notifications.length} kritik bildirim gönderildi (Hasta: ${patient.name})`);
  }

  return notifications.length;
}

module.exports = { sendNotification, runChecks, runHourlyChecks, checkPostSyncCriticals };
