# MedAI - Doktor Bot 🩺

Yapay zeka destekli, çoklu hasta takip sistemi. Hastaların tedavi süreçlerini takip eden, tahlil sonuçlarını yorumlayan, randevuları hatırlatan ve Windows masaüstü bildirimleri gönderen kişisel tıbbi asistan.

---

## 🎯 Özellikler

### Çoklu Hasta Yönetimi
- Birden fazla hasta ekleyebilme (tanılı veya tanısız)
- Her hasta için ayrı tıbbi veri, chat geçmişi ve takip
- Hasta bazlı E-Nabız entegrasyonu

### AI Doktor Chat
- **Çoklu AI Desteği:** OpenAI, Anthropic (Claude), Google (Gemini)
- Hasta özelinde dinamik sistem promptu
- Tahlil sonuçlarını yorumlama
- Beslenme ve yaşam önerileri
- Doktora sorulacak soru hazırlama

### E-Nabız Entegrasyonu
- Playwright ile tarayıcı otomasyonu (reCAPTCHA uyumlu)
- Tahlil sonuçları, reçeteler, radyoloji raporları, epikriz, tıbbi raporlar
- Hasta bazlı ayrı tarayıcı profilleri
- Otomatik periyodik senkronizasyon

### 🔔 Bildirim Sistemi
- **Windows masaüstü bildirimleri** (node-notifier)
- Dakikada bir hatırlatıcı kontrolü
- Randevu hatırlatmaları (önceki gün + zamanında)
- Anormal tahlil sonucu uyarıları
- İlaç hatırlatmaları
- Tekrarlayan hatırlatıcılar (günlük/haftalık/aylık)

### 📅 Hasta Takvimi
- Her hasta için ayrı takvim görünümü
- Ay bazında tüm tıbbi olayları gösterme
- Gün tıklamasıyla detaylı özet (tahlil, ilaç, randevu, olay)
- Renk kodlu göstergeler

### Dosya Yönetimi
- Tahlil raporu, reçete, radyoloji görüntüsü yükleme
- PDF, JPEG, PNG, Excel desteği
- Otomatik dosya türü tanıma

---

## 🏗️ Teknik Mimari

```
Node.js + Express (port 3200)
├── SQLite (better-sqlite3) - 7 tablo
├── Playwright (sistem Chrome) - E-Nabız scraping
├── OpenAI / Anthropic / Google - AI chat
├── node-notifier - Windows bildirimleri
├── node-cron - Zamanlanmış görevler
└── SPA Frontend (Vanilla JS)
```

### Veritabanı Tabloları
- `patients` - Hasta bilgileri
- `medical_events` - Tıbbi olaylar zaman çizelgesi
- `lab_results` - Tahlil sonuçları
- `medications` - İlaçlar
- `chat_history` - AI chat geçmişi
- `uploaded_files` - Yüklenen dosyalar
- `reminders` - Hatırlatıcılar & randevular

---

## 🚀 Kurulum

```bash
# Bağımlılıkları yükle
npm install

# Playwright tarayıcılarını yükle
npx playwright install

# .env dosyasını oluştur
cp .env.example .env

# Sunucuyu başlat
npm start
```

Tarayıcıda `http://localhost:3200` adresine gidin.

---

## ⚙️ .env Yapılandırması

```env
PORT=3200
ENABIZ_TC=           # E-Nabız için TC Kimlik No
ENABIZ_PASSWORD=     # E-Devlet şifresi
ENABIZ_SYNC_INTERVAL=6  # Otomatik sync aralığı (saat)
```

AI API key'leri web arayüzünden ayarlanır (⚙️ AI Ayarları).

---

## 🛡️ Güvenlik & Gizlilik

- Tüm veriler **yerel** olarak saklanır
- API key'ler `data/ai-config.json`'da yerel dosyada tutulur
- E-Devlet şifreleri `.env` dosyasında saklanır
- SQLite veritabanı `.gitignore`'da

---

## ⚠️ Önemli Uyarı

Bu bot bir **tıbbi karar destek aracıdır**, doktor yerine geçmez.
Tüm tıbbi kararlar mutlaka doktor onayı ile alınmalıdır.
Bot tarafından verilen bilgiler yalnızca bilgilendirme amaçlıdır.
