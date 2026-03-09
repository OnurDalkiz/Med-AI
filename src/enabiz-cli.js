/**
 * E-Nabız CLI Aracı
 * 
 * Kullanım:
 *   node src/enabiz-cli.js login              → Tarayıcı açılır, manuel giriş yapın
 *   node src/enabiz-cli.js login --tc TC --pass SIFRE  → Otomatik giriş
 *   node src/enabiz-cli.js fetch              → Tüm verileri çek
 *   node src/enabiz-cli.js fetch --labs       → Sadece tahlilleri çek
 *   node src/enabiz-cli.js capture URL LABEL  → Sayfa yapısını kaydet (debug)
 */

require('dotenv').config();
const ENabizScraper = require('./enabiz-scraper');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const scraper = new ENabizScraper();

  try {
    switch (command) {
      case 'login': {
        // Headful mod (tarayıcı görünür)
        await scraper.launch(false);

        const tcIndex = args.indexOf('--tc');
        const passIndex = args.indexOf('--pass');

        if (tcIndex !== -1 && passIndex !== -1) {
          // Otomatik giriş
          await scraper.login(args[tcIndex + 1], args[passIndex + 1]);
        } else {
          // Manuel giriş
          await scraper.manualLogin();
        }

        console.log('\n📌 Tarayıcı profili kaydedildi. Sonraki çalıştırmalarda otomatik giriş yapılacak.');
        console.log('💡 Veri çekmek için: node src/enabiz-cli.js fetch\n');

        // Tarayıcıyı açık bırak (kullanıcı gezebilsin)
        console.log('Tarayıcıyı kapatmak için Ctrl+C...');
        await new Promise(() => {}); // Sonsuza kadar bekle
        break;
      }

      case 'fetch': {
        await scraper.launch(true); // Headless mod

        // Oturum kontrolü
        if (!scraper.isLoggedIn) {
          console.log('⚠️  Önce giriş yapın: node src/enabiz-cli.js login');
          break;
        }

        if (args.includes('--labs')) {
          await scraper.fetchLabResults();
        } else if (args.includes('--prescriptions')) {
          await scraper.fetchPrescriptions();
        } else if (args.includes('--visits')) {
          await scraper.fetchVisitHistory();
        } else if (args.includes('--radiology')) {
          await scraper.fetchRadiology();
        } else {
          await scraper.fetchAll();
        }
        break;
      }

      case 'capture': {
        const url = args[1] || 'https://enabiz.gov.tr';
        const label = args[2] || 'page';

        await scraper.launch(false);
        await scraper.manualLogin();

        if (scraper.isLoggedIn) {
          const result = await scraper.capturePageStructure(url, label);
          console.log('📸 Kaydedilen dosyalar:', result);
        }

        console.log('Tarayıcıyı kapatmak için Ctrl+C...');
        await new Promise(() => {});
        break;
      }

      default:
        console.log(`
🏥 E-Nabız CLI - MedAI Doktor Bot

Kullanım:
  node src/enabiz-cli.js login                        Manuel giriş (tarayıcı açılır)
  node src/enabiz-cli.js login --tc TC --pass SIFRE   Otomatik giriş
  node src/enabiz-cli.js fetch                        Tüm verileri çek
  node src/enabiz-cli.js fetch --labs                 Sadece tahlilleri çek
  node src/enabiz-cli.js fetch --prescriptions        Sadece reçeteleri çek
  node src/enabiz-cli.js fetch --visits               Muayene geçmişi
  node src/enabiz-cli.js fetch --radiology            Radyoloji raporları
  node src/enabiz-cli.js capture URL LABEL            Sayfa yapısını kaydet (debug)
`);
    }
  } catch (e) {
    console.error('❌ Hata:', e.message);
  } finally {
    if (command === 'fetch') await scraper.close();
  }
}

main();
