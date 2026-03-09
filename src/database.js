const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DB_PATH } = require('./config');

// data klasörünü oluştur
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tabloları oluştur
db.exec(`
  -- Hasta bilgileri
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tc_no TEXT,
    birth_date TEXT,
    gender TEXT,
    diagnosis TEXT,
    diagnosis_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tıbbi olaylar zaman çizelgesi
  CREATE TABLE IF NOT EXISTS medical_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL, -- surgery, lab_result, medication, appointment, note, symptom
    title TEXT NOT NULL,
    description TEXT,
    data JSON, -- ek veriler JSON olarak
    source TEXT, -- manual, enabiz, whatsapp
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  -- Tahlil sonuçları
  CREATE TABLE IF NOT EXISTS lab_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    test_date TEXT NOT NULL,
    test_name TEXT NOT NULL,
    test_value TEXT,
    unit TEXT,
    reference_range TEXT,
    is_abnormal INTEGER DEFAULT 0,
    category TEXT, -- hemogram, biyokimya, tumor_marker, etc.
    source TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  -- İlaçlar
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    dosage TEXT,
    frequency TEXT,
    start_date TEXT,
    end_date TEXT,
    prescribed_by TEXT,
    notes TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  -- AI Chat geçmişi
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    role TEXT NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  -- Yüklenen dosyalar
  CREATE TABLE IF NOT EXISTS uploaded_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    file_path TEXT NOT NULL,
    parsed_content TEXT,
    file_type TEXT, -- lab_report, prescription, radiology, photo, other
    upload_date TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  -- Hatırlatıcılar ve randevular
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    reminder_type TEXT NOT NULL, -- appointment, medication, checkup, custom
    reminder_date TEXT NOT NULL, -- YYYY-MM-DD
    reminder_time TEXT NOT NULL, -- HH:MM
    repeat_type TEXT, -- none, daily, weekly, monthly
    notified INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );
`);

// Deduplication: Önce mevcut duplikeleri temizle, sonra unique indexler oluştur
// Sadece index yoksa çalışır (ilk sefer)
const hasLabIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_lab_unique'").get();
if (!hasLabIndex) {
  db.exec(`
    DELETE FROM lab_results WHERE id NOT IN (
      SELECT MIN(id) FROM lab_results GROUP BY patient_id, test_date, test_name, test_value
    );
    CREATE UNIQUE INDEX idx_lab_unique ON lab_results(patient_id, test_date, test_name, test_value);
  `);
}

const hasEventIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_event_unique'").get();
if (!hasEventIndex) {
  db.exec(`
    DELETE FROM medical_events WHERE id NOT IN (
      SELECT MIN(id) FROM medical_events GROUP BY patient_id, event_date, event_type, title
    );
    CREATE UNIQUE INDEX idx_event_unique ON medical_events(patient_id, event_date, event_type, title);
  `);
}

const hasMedIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_med_unique'").get();
if (!hasMedIndex) {
  db.exec(`
    DELETE FROM medications WHERE id NOT IN (
      SELECT MIN(id) FROM medications GROUP BY patient_id, name, start_date
    );
    CREATE UNIQUE INDEX idx_med_unique ON medications(patient_id, name, start_date);
  `);
}

module.exports = db;
