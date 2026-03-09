const db = require('./database');
const fs = require('fs');
const path = require('path');

function seedPatient() {
  const existing = db.prepare('SELECT id FROM patients WHERE name = ?').get('Derya Dalkız');
  if (existing) return;

  console.log('📥 Hasta verisi yükleniyor...');

  // JSON metadata'dan hasta oluştur
  const metaPath = path.join(__dirname, '..', 'patient-data', 'derya-dalkiz.json');
  let meta = {};
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  // Hasta ekle
  const result = db.prepare(
    'INSERT INTO patients (name, gender, diagnosis, diagnosis_date, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(
    'Derya Dalkız',
    'Erkek',
    'Pankreas Kanseri',
    '2026-03-01',
    'Kitle karaciğere giden damara (portal ven/hepatik arter) yapışmış. Ameliyatta tam rezeksiyon yapılamadı.'
  );

  const patientId = result.lastInsertRowid;

  // Zaman çizelgesinden olayları ekle
  const events = [
    {
      date: '2026-03-01', type: 'diagnosis', title: 'Pankreas Kanseri Teşhisi',
      desc: 'Pankreas kanseri teşhisi kondu. Tedavi planlaması başladı.'
    },
    {
      date: '2026-03-04', type: 'note', title: 'Hastane Bağlantısı Sağlandı',
      desc: 'Onur\'un müdürü aracılığıyla hastanenin klinik şefini tanıyan biri yönlendirildi. Durumu aktarıp ilgilenilmesini sağlayacak.'
    },
    {
      date: '2026-03-05', type: 'surgery', title: 'Kitle Alma Ameliyatı',
      desc: 'Pankreas kitlesini almak için ameliyata alındı. Kitle karaciğere giden damara yapışmış olduğu için tam rezeksiyon yapılamadı. Drenaj hortumları takıldı.'
    },
    {
      date: '2026-03-05', type: 'note', title: 'Doktor Görüşmesi',
      desc: 'Özgür abi ameliyatı yapan doktorla bizzat görüştü.'
    },
    {
      date: '2026-03-07', type: 'note', title: 'Post-op Toparlanma',
      desc: 'Toparlanıyor. Ağrısı yok. Gece serum ve ağrı kesici takılıyor. Hortumlardan dolayı zorlanma devam ediyor.'
    },
    {
      date: '2026-03-08', type: 'note', title: 'Ziyaretçi Kabul - İyileşme',
      desc: 'Cana gelmiş. Ziyaretçi kabul ediyor (Necmettin amca, Erol amca). Hortumlar hala rahatsız ediyor ama genel durum iyi.'
    },
    {
      date: '2026-03-09', type: 'note', title: 'Ameliyat Yarası Durumu',
      desc: 'Ameliyat yarası fotoğrafı paylaşıldı. Servis kaydı açtırılacak.'
    }
  ];

  const insertEvent = db.prepare(
    'INSERT INTO medical_events (patient_id, event_date, event_type, title, description, source) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const e of events) {
    insertEvent.run(patientId, e.date, e.type, e.title, e.desc, 'whatsapp');
  }

  console.log(`✅ Hasta oluşturuldu (ID: ${patientId}) - ${events.length} tıbbi olay eklendi`);
}

module.exports = { seedPatient };
