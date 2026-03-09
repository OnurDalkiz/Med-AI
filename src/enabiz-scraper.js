const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const ENABIZ_URL = 'https://enabiz.gov.tr';
const LOGIN_URL = 'https://enabiz.gov.tr/Account/Login';
const BROWSER_BASE_DIR = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'med-ai-browser');

class ENabizScraper {
  constructor(patientId) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isLoggedIn = false;
    this.patientId = patientId;
    this.navLinks = {};
    this.userDataDir = path.join(BROWSER_BASE_DIR, `patient-${patientId}`);
  }

  // TarayÄ±cÄ±yÄ± baÅŸlat (kalÄ±cÄ± profil ile - cookie'ler saklanÄ±r)
  async launch(headless = false) {
    if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });

    this.browser = await chromium.launchPersistentContext(this.userDataDir, {
      channel: 'chrome',
      headless,
      viewport: { width: 1280, height: 800 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      args: ['--disable-blink-features=AutomationControlled']
    });

    this.page = this.browser.pages()[0] || await this.browser.newPage();

    // Bot algÄ±lamayÄ± engellemek iÃ§in navigator.webdriver'Ä± gizle
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['tr-TR', 'tr', 'en-US', 'en']
      });
    });

    console.log('ðŸŒ TarayÄ±cÄ± baÅŸlatÄ±ldÄ± (anti-detection aktif)');
    return this;
  }

  // E-NabÄ±z'a TC + ÅŸifre ile giriÅŸ
  async login(tcNo, password) {
    console.log('ðŸ” E-NabÄ±z giriÅŸ yapÄ±lÄ±yor...');
    await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    // Cookie popup varsa kapat
    try {
      const cookieBtn = this.page.locator('text=Okay').or(this.page.locator('text=Tamam'));
      if (await cookieBtn.isVisible({ timeout: 2000 })) await cookieBtn.click();
    } catch (e) { /* cookie popup yok */ }

    // Zaten giriÅŸ yapÄ±lmÄ±ÅŸ mÄ± kontrol et (kalÄ±cÄ± profil sayesinde)
    try {
      await this.page.waitForURL('**/Home/**', { timeout: 5000 });
      console.log('âœ… Zaten giriÅŸ yapÄ±lmÄ±ÅŸ (kayÄ±tlÄ± oturum)');
      this.isLoggedIn = true;
      return true;
    } catch (e) { /* giriÅŸ yapÄ±lmamÄ±ÅŸ, devam */ }

    // TC ve ÅŸifre alanlarÄ±nÄ± doldur
    const tcInput = this.page.locator('input[name="TCKimlikNo"], input[id*="TCKimlik"], input[placeholder*="T.C."]').first();
    const passInput = this.page.locator('input[type="password"]').first();

    await tcInput.waitFor({ timeout: 10000 });
    await tcInput.fill(tcNo);
    await passInput.fill(password);

    // GiriÅŸ butonuna tÄ±kla
    const loginBtn = this.page.locator('button[type="submit"], input[type="submit"], button:has-text("GiriÅŸ")').first();
    await loginBtn.click();

    // Captcha veya SMS doÄŸrulama olabilir - kullanÄ±cÄ±ya bilgi ver
    console.log('â³ GiriÅŸ bekleniyor (Captcha/SMS doÄŸrulama gerekirse tarayÄ±cÄ±da tamamlayÄ±n)...');

    try {
      await this.page.waitForURL('**/Home/**', { timeout: 120000 }); // 2 dakika bekle
      console.log('âœ… E-NabÄ±z giriÅŸ baÅŸarÄ±lÄ±!');
      this.isLoggedIn = true;
      return true;
    } catch (e) {
      console.error('âŒ GiriÅŸ zaman aÅŸÄ±mÄ± - Captcha/SMS doÄŸrulamayÄ± tamamlayÄ±n');
      return false;
    }
  }

  // Manuel giriÅŸ: tarayÄ±cÄ±yÄ± aÃ§, kullanÄ±cÄ± kendisi giriÅŸ yapsÄ±n
  async manualLogin() {
    console.log('ðŸ” TarayÄ±cÄ± aÃ§Ä±ldÄ± - E-NabÄ±z\'a manuel giriÅŸ yapÄ±n...');

    // Ã–nce mevcut oturumu kontrol et â€” login sayfasÄ±na hiÃ§ gitmeden
    try {
      await this.page.goto(`${ENABIZ_URL}/Home/Index`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const currentUrl = this.page.url();
      if (currentUrl.includes('/Home') && !currentUrl.includes('Login')) {
        console.log('âœ… Zaten giriÅŸ yapÄ±lmÄ±ÅŸ (kayÄ±tlÄ± oturum)');
        this.isLoggedIn = true;
        return true;
      }
    } catch (e) {
      console.log('  â„¹ï¸ Oturum kontrolÃ¼ atlanÄ±yor:', e.message?.substring(0, 80));
    }

    // Login sayfasÄ±na git (retry ile)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        break; // baÅŸarÄ±lÄ±ysa dÃ¶ngÃ¼den Ã§Ä±k
      } catch (e) {
        console.log(`  âš ï¸ Login sayfasÄ± yÃ¼kleme denemesi ${attempt}/3:`, e.message?.substring(0, 80));
        if (attempt < 3) {
          await this.page.waitForTimeout(2000);
        } else {
          // Son denemede hÃ¢lÃ¢ baÅŸarÄ±sÄ±zsa, Google'a gidip oradan dene
          try {
            await this.page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
            await this.page.waitForTimeout(1000);
            await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (e2) {
            throw new Error('E-NabÄ±z login sayfasÄ±na eriÅŸilemiyor: ' + e2.message);
          }
        }
      }
    }

    // Zaten giriÅŸ yapÄ±lmÄ±ÅŸ mÄ± kontrol et (kalÄ±cÄ± profil sayesinde)
    try {
      await this.page.waitForURL('**/Home/**', { timeout: 8000 });
      console.log('âœ… Zaten giriÅŸ yapÄ±lmÄ±ÅŸ (kayÄ±tlÄ± oturum)');
      this.isLoggedIn = true;
      return true;
    } catch (e) { /* giriÅŸ yapÄ±lmamÄ±ÅŸ, devam */ }

    console.log('â³ GiriÅŸ yapmanÄ±zÄ± bekliyorum (10 dakika sÃ¼reniz var)...');
    console.log('ðŸ“Œ TarayÄ±cÄ±da E-NabÄ±z\'a giriÅŸ yapÄ±n, /Home sayfasÄ±na yÃ¶nlendirilene kadar bekliyorum.');
    try {
      await this.page.waitForURL('**/Home/**', { timeout: 600000 }); // 10 dakika
      console.log('âœ… GiriÅŸ baÅŸarÄ±lÄ±!');
      this.isLoggedIn = true;
      return true;
    } catch (e) {
      console.error('âŒ GiriÅŸ zaman aÅŸÄ±mÄ± (10 dakika doldu)');
      return false;
    }
  }

  // ============ RADYOLOJI GORUNTU ============
  async getRadiologyImage(imageId) {
    if (!this.isLoggedIn || !this.page) return null;
    try {
      // 1. Once DB'den thumbnail varsa direkt don
      const dbRow = db.prepare(
        "SELECT data FROM medical_events WHERE event_type='radiology' AND patient_id=? AND json_extract(data,'$.imageId')=?"
      ).get(this.patientId, imageId);
      if (dbRow) {
        const d = JSON.parse(dbRow.data || '{}');
        if (d.thumbnailData) {
          console.log('Radyoloji thumbnail DB den alindi');
          return { dataUrl: d.thumbnailData, contentType: 'image/png' };
        }
      }

      // 2. Radyoloji sayfasina git ve thumbnail'i yakala
      const radUrl = this.navLinks.radiology || 'https://enabiz.gov.tr/Home/RadyolojikGoruntulerim';
      await this.page.goto(radUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini genis tut
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 2000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) await startYearSelect.selectOption(years[years.length - 1]);
        }
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch(e) { /* filtre yok */ }

      // 3. Kartlardan thumbnail veya image bul
      const imgData = await this.page.evaluate((targetId) => {
        const cards = document.querySelectorAll('.radyolojiCardListe, .radyolojiCardContainer .card');
        for (const card of cards) {
          const imgBtn = card.querySelector('a[onclick*="openImageLink"], button[onclick*="openImageLink"]');
          if (imgBtn) {
            const onclick = imgBtn.getAttribute('onclick') || '';
            const m = onclick.match(/openImageLink\('([^']+)'\)/);
            if (m && m[1] === targetId) {
              // Bu kart! Thumbnail varsa al
              const thumb = card.querySelector('img[src*="data:image"]');
              if (thumb) return thumb.getAttribute('src');
              // Baska img varsa
              const anyImg = card.querySelector('img[src]');
              if (anyImg && anyImg.src.startsWith('http')) return anyImg.src;
            }
          }
        }
        return null;
      }, imageId);

      if (imgData) {
        console.log('Radyoloji thumbnail sayfadan alindi');
        // DB'ye de kaydet
        try {
          db.prepare(
            "UPDATE medical_events SET data=json_set(data,'$.thumbnailData',?) WHERE event_type='radiology' AND patient_id=? AND json_extract(data,'$.imageId')=?"
          ).run(imgData, this.patientId, imageId);
        } catch(e) { /* update failed */ }
        return { dataUrl: imgData, contentType: 'image/png' };
      }

      // 4. openImageLink ile yeni sayfa acmayi dene
      try {
        const newPagePromise = this.page.context().waitForEvent('page', { timeout: 10000 });
        await this.page.evaluate((id) => {
          if (typeof openImageLink === 'function') openImageLink(id);
        }, imageId);
        const newPage = await newPagePromise;
        await newPage.waitForLoadState('load', { timeout: 15000 });
        await newPage.waitForTimeout(2000);
        const screenshot = await newPage.screenshot({ fullPage: true, type: 'png' });
        await newPage.close();
        const b64 = screenshot.toString('base64');
        return { dataUrl: 'data:image/png;base64,' + b64, contentType: 'image/png' };
      } catch(e) {
        console.log('openImageLink fallback basarisiz:', e.message);
      }

      return null;
    } catch(e) {
      console.error('Radyoloji goruntu hatasi:', e.message);
      return null;
    }
  }

  // ============ NAVÄ°GASYON KEÅžFÄ° ============

  // Oturumu canlÄ± tut â€” E-NabÄ±z session timeout'unu Ã¶nle
  async keepAlive() {
    if (!this.isLoggedIn || !this.page) return false;
    try {
      // Hafif bir API isteÄŸi yap (sayfa deÄŸiÅŸtirmeden)
      const isAlive = await this.page.evaluate(async () => {
        try {
          const resp = await fetch('/Home/Index', { method: 'HEAD', credentials: 'include' });
          return resp.ok || resp.status === 302;
        } catch (e) { return false; }
      });

      if (isAlive) {
        console.log('ðŸ’“ E-NabÄ±z oturum keep-alive baÅŸarÄ±lÄ±');
        return true;
      }

      // HEAD baÅŸarÄ±sÄ±z olduysa, tam sayfa navigasyonu dene
      const resp = await this.page.goto(`${ENABIZ_URL}/Home/Index`, {
        waitUntil: 'domcontentloaded', timeout: 15000
      });
      const url = this.page.url();
      if (url.includes('/Home') && !url.includes('Login')) {
        console.log('ðŸ’“ E-NabÄ±z oturum keep-alive baÅŸarÄ±lÄ± (navigasyon)');
        return true;
      }

      // Login sayfasÄ±na yÃ¶nlendirildi â€” oturum dÃ¼ÅŸmÃ¼ÅŸ
      console.log('âš ï¸ E-NabÄ±z oturumu dÃ¼ÅŸmÃ¼ÅŸ, yeniden giriÅŸ gerekiyor');
      this.isLoggedIn = false;
      return false;
    } catch (e) {
      console.error('âŒ Keep-alive hatasÄ±:', e.message);
      return false;
    }
  }

  // Ana sayfadan tÃ¼m menÃ¼ linklerini keÅŸfet
  async discoverNavLinks() {
    console.log('ðŸ” E-NabÄ±z menÃ¼ yapÄ±sÄ± keÅŸfediliyor...');

    try {
      // Ana sayfaya git
      await this.page.goto(`${ENABIZ_URL}/Home/Index`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await this.page.waitForTimeout(3000);

      // Sayfadaki tÃ¼m linkleri ve menÃ¼ Ã¶ÄŸelerini tara
      const allLinks = await this.page.evaluate(() => {
        const links = [];
        // TÃ¼m <a> etiketlerini tara
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent?.trim() || '';
          if (href && !href.startsWith('#') && !href.startsWith('javascript') && text) {
            links.push({ href, text: text.substring(0, 100) });
          }
        });
        // MenÃ¼ butonlarÄ± da olabilir
        document.querySelectorAll('[data-url], [data-href], [onclick]').forEach(el => {
          const url = el.getAttribute('data-url') || el.getAttribute('data-href') || '';
          const text = el.textContent?.trim() || '';
          if (url && text) {
            links.push({ href: url, text: text.substring(0, 100) });
          }
        });
        return links;
      });

      // Kategori eÅŸleÅŸtirmesi: TÃ¼rkÃ§e anahtar kelimelere gÃ¶re linkleri bul
      const categories = {
        labs: ['tahlil'],
        prescriptions: ['recete', 'reÃ§ete'],
        visits: ['ziyaret', 'randevu'],
        radiology: ['radyolojik'],
        allergies: ['alerji'],
        vaccines: ['aÅŸÄ± takvimi', 'asi takvimi', 'asitakvimi'],
        chronic: ['hastalÄ±klarÄ±m', 'hastaliklarim'],
        diagnoses: ['hastalÄ±klarÄ±m', 'hastaliklarim'],
        surgeries: ['ameliyat'],
        epicrisis: ['epikriz'],
        reports: ['raporlarÄ±m', 'raporlarim'],
        pathology: ['patoloji'],
        medications: ['ilaÃ§larÄ±m', 'ilaclarim'],
        screenings: ['tarama'],
        emergencyNotes: ['acil durum not'],
        documents: ['dokÃ¼manlarÄ±m', 'dokumanlarim']
      };

      for (const [category, keywords] of Object.entries(categories)) {
        for (const link of allLinks) {
          // Sadece enabiz.gov.tr linkleri (harici linkleri atla)
          if (link.href.startsWith('http') && !link.href.includes('enabiz.gov.tr')) continue;
          const combined = (link.text + ' ' + link.href).toLowerCase();
          if (keywords.some(kw => combined.includes(kw))) {
            this.navLinks[category] = link.href.startsWith('http')
              ? link.href
              : `${ENABIZ_URL}${link.href.startsWith('/') ? '' : '/'}${link.href}`;
            console.log(`  ðŸ“Œ ${category}: ${this.navLinks[category]} (${link.text})`);
            break;
          }
        }
      }

      // Bulunamayan kategoriler iÃ§in keÅŸfedilen tÃ¼m linkleri logla
      const foundCategories = Object.keys(this.navLinks);
      const missingCategories = Object.keys(categories).filter(c => !foundCategories.includes(c));

      if (missingCategories.length > 0) {
        console.log(`âš ï¸ Bulunamayan kategoriler: ${missingCategories.join(', ')}`);
        console.log('ðŸ“‹ Sayfadaki tÃ¼m linkler:');
        allLinks.forEach(l => console.log(`   ${l.text} â†’ ${l.href}`));
      }

      // Linkleri dosyaya kaydet (debug iÃ§in)
      const linksPath = path.join(__dirname, '..', 'data', 'enabiz-nav-links.json');
      fs.writeFileSync(linksPath, JSON.stringify({ discovered: this.navLinks, allLinks, timestamp: new Date().toISOString() }, null, 2));

      console.log(`âœ… ${foundCategories.length}/${Object.keys(categories).length} kategori keÅŸfedildi`);
      return this.navLinks;
    } catch (e) {
      console.error('âŒ Nav keÅŸif hatasÄ±:', e.message);
      return {};
    }
  }

  // MenÃ¼ tÄ±klayarak veya URL ile sayfaya git
  async navigateToSection(category, fallbackKeywords) {
    // 1. KeÅŸfedilmiÅŸ link varsa kullan
    if (this.navLinks[category]) {
      console.log(`  ðŸ”— KeÅŸfedilen link kullanÄ±lÄ±yor: ${this.navLinks[category]}`);
      const response = await this.page.goto(this.navLinks[category], {
        waitUntil: 'domcontentloaded', timeout: 30000
      });

      // 404 kontrolÃ¼
      if (response && response.status() !== 404) {
        await this.page.waitForTimeout(3000);
        return true;
      }
      console.log(`  âš ï¸ KeÅŸfedilen link 404 verdi, menÃ¼ tÄ±klama denenecek...`);
    }

    // 2. MenÃ¼ elementini tÄ±klamayÄ± dene
    for (const keyword of fallbackKeywords) {
      try {
        // Ã–nce ana sayfaya dÃ¶n
        await this.page.goto(`${ENABIZ_URL}/Home/Index`, {
          waitUntil: 'domcontentloaded', timeout: 15000
        });
        await this.page.waitForTimeout(2000);

        // MenÃ¼deki linki veya butonu bul
        const menuItem = this.page.locator(`a:has-text("${keyword}"), button:has-text("${keyword}"), [class*="menu"] >> text="${keyword}"`).first();
        if (await menuItem.isVisible({ timeout: 3000 })) {
          console.log(`  ðŸ–±ï¸ MenÃ¼ tÄ±klanÄ±yor: "${keyword}"`);
          await menuItem.click();
          await this.page.waitForTimeout(3000);

          // 404 kontrolÃ¼
          const url = this.page.url();
          const content = await this.page.content();
          if (!content.includes('404') && !content.includes("can't be found")) {
            // BaÅŸarÄ±lÄ± navigasyon - linki kaydet
            this.navLinks[category] = url;
            return true;
          }
        }
      } catch (e) { /* bu keyword ile bulamadÄ±k, sonrakini dene */ }
    }

    // 3. Sidebar/hamburger menÃ¼yÃ¼ aÃ§ ve tekrar dene
    try {
      const menuToggle = this.page.locator('[class*="hamburger"], [class*="menu-toggle"], .navbar-toggler, [class*="sidebar"] button').first();
      if (await menuToggle.isVisible({ timeout: 2000 })) {
        await menuToggle.click();
        await this.page.waitForTimeout(1000);

        for (const keyword of fallbackKeywords) {
          const sideItem = this.page.locator(`a:has-text("${keyword}"), [class*="nav"] >> text="${keyword}"`).first();
          if (await sideItem.isVisible({ timeout: 2000 })) {
            console.log(`  ðŸ–±ï¸ Sidebar menÃ¼ tÄ±klanÄ±yor: "${keyword}"`);
            await sideItem.click();
            await this.page.waitForTimeout(3000);
            this.navLinks[category] = this.page.url();
            return true;
          }
        }
      }
    } catch (e) { /* sidebar yok */ }

    console.log(`  âŒ "${category}" sayfasÄ±na ulaÅŸÄ±lamadÄ±`);
    return false;
  }

  // ============ VERÄ° Ã‡EKME FONKSÄ°YONLARI ============

  // Sayfa navigasyonu yapÄ±p AJAX verilerin yÃ¼klenmesini bekle
  async navigateAndWait(category, fallbackKeywords) {
    const navigated = await this.navigateToSection(category, fallbackKeywords);
    if (!navigated) return false;

    // AJAX verilerinin yÃ¼klenmesini bekle (networkidle + extra sÃ¼re)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (e) { /* timeout olabilir, devam */ }
    await this.page.waitForTimeout(3000);

    return true;
  }

  // Network interceptor: sayfaya giderken yapÄ±lan API Ã§aÄŸrÄ±larÄ±nÄ± yakala
  async fetchWithNetworkCapture(url, label) {
    const apiResponses = [];

    // XHR/fetch isteklerini dinle
    const captureHandler = async (response) => {
      try {
        const reqUrl = response.url();
        const status = response.status();
        const contentType = response.headers()['content-type'] || '';

        // JSON API yanÄ±tlarÄ±nÄ± yakala (sayfa asset'leri hariÃ§)
        if (status === 200 && (contentType.includes('json') || contentType.includes('text/plain'))) {
          // Static dosyalarÄ± atla
          if (reqUrl.match(/\.(js|css|png|jpg|svg|woff|ico|map)(\?|$)/i)) return;

          const body = await response.text().catch(() => '');
          if (body && body.length > 2) {
            apiResponses.push({
              url: reqUrl,
              contentType,
              body: body.substring(0, 100000),
              size: body.length
            });
            console.log(`    ðŸ“¡ API yakalandÄ±: ${reqUrl.substring(0, 100)} (${body.length} bytes)`);
          }
        }
      } catch (e) { /* yanÄ±t okunamadÄ± */ }
    };

    this.page.on('response', captureHandler);

    try {
      // Sayfaya git
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Network idle + ekstra bekleme
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch (e) { /* timeout olabilir */ }
      await this.page.waitForTimeout(5000);

    } finally {
      this.page.removeListener('response', captureHandler);
    }

    return apiResponses;
  }

  // Full DOM yapÄ± analizi â€” sayfadaki tÃ¼m anlamlÄ± text node'larÄ± Ã§ek
  async extractFullPageContent() {
    return await this.page.evaluate(() => {
      const data = {
        title: document.title,
        url: window.location.href,
        tables: [],
        textBlocks: [],
        forms: [],
        structure: []
      };

      // 1. TÃ¼m tablolarÄ± Ã§ek (header + body)
      document.querySelectorAll('table').forEach((table, ti) => {
        const tableData = { index: ti, headers: [], rows: [] };
        table.querySelectorAll('thead th, thead td').forEach(th => {
          tableData.headers.push(th.textContent?.trim());
        });
        table.querySelectorAll('tbody tr').forEach(row => {
          const cells = [];
          row.querySelectorAll('td, th').forEach(cell => {
            cells.push(cell.textContent?.trim());
          });
          if (cells.some(c => c && c.length > 0)) {
            tableData.rows.push(cells);
          }
        });
        if (tableData.rows.length > 0 || tableData.headers.length > 0) {
          data.tables.push(tableData);
        }
      });

      // 2. Sayfadaki tÃ¼m bÃ¼yÃ¼k text bloklarÄ±nÄ± Ã§ek (nav/header hariÃ§)
      const skipTags = new Set(['NAV', 'HEADER', 'FOOTER', 'SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT']);
      const visited = new Set();

      function collectText(el, depth = 0) {
        if (!el || depth > 15) return;
        if (skipTags.has(el.tagName)) return;
        // Nav class'lÄ± elemanlarÄ± atla
        const cls = (el.className || '').toString().toLowerCase();
        if (cls.includes('nav') || cls.includes('header') || cls.includes('footer') || cls.includes('cookie')) return;

        const text = el.textContent?.trim();
        if (!text || text.length < 3 || visited.has(text)) return;

        // Yaprak dÃ¼ÄŸÃ¼m veya anlamlÄ± iÃ§erik
        if (el.children.length === 0 || text.length < 500) {
          if (text.length >= 3 && text.length < 5000) {
            visited.add(text);
            data.textBlocks.push({
              tag: el.tagName,
              class: cls.substring(0, 200),
              id: (el.id || '').substring(0, 100),
              text: text.substring(0, 2000),
              depth
            });
          }
        } else {
          // Ã‡ocuklarÄ± tara
          for (const child of el.children) {
            collectText(child, depth + 1);
          }
        }
      }

      // body'nin doÄŸrudan Ã§ocuklarÄ±ndan baÅŸla
      for (const child of document.body.children) {
        collectText(child);
      }

      // 3. DOM yapÄ± haritasÄ± (ilk 3 seviye)
      function mapStructure(el, depth = 0) {
        if (depth > 3 || !el || skipTags.has(el.tagName)) return null;
        const info = {
          tag: el.tagName,
          id: el.id || undefined,
          class: (el.className || '').toString().substring(0, 150) || undefined,
          childCount: el.children.length,
          textLen: (el.textContent?.trim() || '').length
        };
        if (depth < 3 && el.children.length > 0 && el.children.length < 30) {
          info.children = [];
          for (const child of el.children) {
            const mapped = mapStructure(child, depth + 1);
            if (mapped) info.children.push(mapped);
          }
        }
        return info;
      }

      data.structure = mapStructure(document.body);

      return data;
    });
  }

  // Tahlil sonuÃ§larÄ±nÄ± Ã§ek - Network interception + DOM analizi
  async fetchLabResults() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ”¬ Tahlil sonuÃ§larÄ± Ã§ekiliyor...');

    try {
      const labUrl = this.navLinks.labs || `${ENABIZ_URL}/Home/Tahlillerim`;
      await this.page.goto(labUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniÅŸ aralÄ±ÄŸa ayarla (en eski yÄ±l â†’ 2026)
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            const earliest = years[years.length - 1]; // son option genelde en eski yÄ±l
            await startYearSelect.selectOption(earliest);
            console.log(`  ðŸ“… BaÅŸlangÄ±Ã§ yÄ±lÄ±: ${earliest}`);
          }
        }
        // Ara butonuna tÄ±kla
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { console.log('  âš ï¸ Tarih filtresi ayarlanamadÄ±:', e.message); }

      // E-NabÄ±z'Ä±n tahlil DOM yapÄ±sÄ±nÄ± doÄŸrudan parse et
      console.log('  ðŸ” E-NabÄ±z tahlil DOM yapÄ±sÄ± parse ediliyor...');
      const labData = await this.page.evaluate(() => {
        const results = [];
        // Her accordion item (tarih grubu)
        const accordionItems = document.querySelectorAll('#accordionTahlilListe .accordion-item, .acordionListe .accordion-item');

        for (const item of accordionItems) {
          // Tarih bilgisi
          const dateEl = item.querySelector('.tAcordionDate, .zTarihS');
          let testDate = '';
          if (dateEl) {
            const hidden = dateEl.querySelector('.zTarihS');
            if (hidden) {
              testDate = hidden.textContent.trim(); // "09.03.2026" formatÄ±
            } else {
              const gun = dateEl.querySelector('.zCardDateGun')?.textContent?.trim() || '';
              const ay = dateEl.querySelector('.zCardDateAy')?.textContent?.trim() || '';
              const yil = dateEl.querySelector('.zCardDateYil')?.textContent?.trim() || '';
              if (gun && yil) testDate = `${gun}.${ay}.${yil}`;
            }
          }

          // Hastane adÄ±
          const hospital = item.querySelector('.hastaneAdi')?.textContent?.trim() || '';

          // Her tahlil grubu (Hemogram, Biyokimya, vs.)
          const tahlilLists = item.querySelectorAll('.tahlilList');
          for (const tlist of tahlilLists) {
            const groupHeader = tlist.querySelector('.tahlilHeader [islemadi], .tahlilHeader #islemAdi');
            const groupName = groupHeader?.getAttribute('islemadi') || groupHeader?.textContent?.trim() || '';

            // Her test satÄ±rÄ±
            const rows = tlist.querySelectorAll('.tahlilBody .rowContaier, .tahlilBody .rowContainer');
            for (const row of rows) {
              const nameEl = row.querySelector('.islemAdiContainer [islemadi], .islemAdiContainer #islemAdi');
              const testName = nameEl?.getAttribute('islemadi') || '';

              // SonuÃ§, Birim, Referans - columnContainer divlerinden Ã§ek
              const cols = row.querySelectorAll('.columnContainer');
              let testValue = '', unit = '', refRange = '';
              for (const col of cols) {
                const text = col.textContent?.trim() || '';
                const label = col.querySelector('span')?.textContent?.trim() || '';
                const value = text.replace(label, '').trim();
                if (label.includes('SonuÃ§') && !label.includes('Birimi')) testValue = value;
                else if (label.includes('Birimi')) unit = value;
                else if (label.includes('Referans')) refRange = value;
              }

              // Normal/anormal durumu
              const statusEl = row.querySelector('.durumRefdisi, .durumNormal');
              const isAbnormal = statusEl?.className?.includes('durumRefdisi') ? true : false;

              if (testName && testValue) {
                results.push({
                  testName, testValue, unit, referenceRange: refRange,
                  date: testDate, groupName, hospital, isAbnormal
                });
              }
            }
          }
        }
        return results;
      });

      console.log(`  ðŸ“Š DOM'dan ${labData.length} tahlil sonucu Ã§Ä±karÄ±ldÄ±`);

      // Accordion kapalÄ±ysa ve sonuÃ§ yoksa, tÃ¼m accordionlarÄ± aÃ§ ve tekrar dene
      if (labData.length === 0) {
        console.log('  ðŸ”„ Accordion kapalÄ± olabilir, aÃ§Ä±lÄ±yor...');
        await this.page.evaluate(() => {
          document.querySelectorAll('.accordion-collapse.collapse:not(.show)').forEach(el => {
            el.classList.add('show');
          });
        });
        await this.page.waitForTimeout(1000);

        // Tekrar dene
        const retryData = await this.page.evaluate(() => {
          const results = [];
          const rows = document.querySelectorAll('.tahlilBody .rowContaier, .tahlilBody .rowContainer');
          for (const row of rows) {
            const nameEl = row.querySelector('[islemadi]');
            const testName = nameEl?.getAttribute('islemadi') || '';
            const cols = row.querySelectorAll('.columnContainer');
            let testValue = '', unit = '', refRange = '';
            for (const col of cols) {
              const text = col.textContent?.trim() || '';
              const label = col.querySelector('span')?.textContent?.trim() || '';
              const value = text.replace(label, '').trim();
              if (label.includes('SonuÃ§') && !label.includes('Birimi')) testValue = value;
              else if (label.includes('Birimi')) unit = value;
              else if (label.includes('Referans')) refRange = value;
            }
            if (testName && testValue) {
              // Ãœst accordion'dan tarih
              const accordion = row.closest('.accordion-item');
              const hidden = accordion?.querySelector('.zTarihS');
              const date = hidden?.textContent?.trim() || '';
              const hospital = accordion?.querySelector('.hastaneAdi')?.textContent?.trim() || '';
              const isAbnormal = row.querySelector('.durumRefdisi') ? true : false;
              results.push({ testName, testValue, unit, referenceRange: refRange, date, hospital, isAbnormal });
            }
          }
          return results;
        });

        if (retryData.length > 0) {
          labData.push(...retryData);
          console.log(`  ðŸ“Š Accordion aÃ§Ä±ldÄ±ktan sonra ${retryData.length} sonuÃ§ bulundu`);
        }
      }

      // Hala sonuÃ§ yoksa dateSelect'ten tarihleri seÃ§meyi dene
      if (labData.length === 0) {
        console.log('  ðŸ”„ Tarih seÃ§ici ile yÃ¼kleme deneniyor...');
        const dateOptions = await this.page.evaluate(() => {
          const sel = document.querySelector('#dateSelect');
          if (!sel) return [];
          return Array.from(sel.options).map(o => o.text?.trim()).filter(t => t && /\d{2}\.\d{2}\.\d{4}/.test(t));
        });
        console.log(`  ðŸ“… ${dateOptions.length} tarih mevcut: ${dateOptions.slice(0, 5).join(', ')}...`);

        for (const dateOpt of dateOptions) {
          await this.page.selectOption('#dateSelect', { label: dateOpt });
          await this.page.waitForTimeout(2000);

          // Accordion aÃ§Ä±ldÄ±ktan sonra tekrar parse et
          await this.page.evaluate(() => {
            document.querySelectorAll('.accordion-collapse.collapse:not(.show)').forEach(el => {
              el.classList.add('show');
            });
          });
          await this.page.waitForTimeout(500);

          const dateData = await this.page.evaluate((selectedDate) => {
            const results = [];
            const rows = document.querySelectorAll('.tahlilBody .rowContaier, .tahlilBody .rowContainer');
            for (const row of rows) {
              const nameEl = row.querySelector('[islemadi]');
              const testName = nameEl?.getAttribute('islemadi') || '';
              const cols = row.querySelectorAll('.columnContainer');
              let testValue = '', unit = '', refRange = '';
              for (const col of cols) {
                const text = col.textContent?.trim() || '';
                const label = col.querySelector('span')?.textContent?.trim() || '';
                const value = text.replace(label, '').trim();
                if (label.includes('SonuÃ§') && !label.includes('Birimi')) testValue = value;
                else if (label.includes('Birimi')) unit = value;
                else if (label.includes('Referans')) refRange = value;
              }
              if (testName && testValue) {
                const accordion = row.closest('.accordion-item');
                const hospital = accordion?.querySelector('.hastaneAdi')?.textContent?.trim() || '';
                const isAbnormal = row.querySelector('.durumRefdisi') ? true : false;
                results.push({ testName, testValue, unit, referenceRange: refRange, date: selectedDate, hospital, isAbnormal });
              }
            }
            return results;
          }, dateOpt);

          if (dateData.length > 0) {
            labData.push(...dateData);
            console.log(`    âœ… ${dateOpt}: ${dateData.length} sonuÃ§`);
          }
        }
      }

      await this.savePageDebug('labs');

      // Tarih formatÄ±nÄ± DD.MM.YYYY â†’ YYYY-MM-DD'ye Ã§evir
      const formatDate = (d) => {
        if (!d) return new Date().toISOString().split('T')[0];
        const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
      };

      // VeritabanÄ±na kaydet
      const insert = db.prepare(
        'INSERT OR IGNORE INTO lab_results (patient_id, test_date, test_name, test_value, unit, reference_range, is_abnormal, category, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );

      let saved = 0;
      for (const lab of labData) {
        if (lab.testName && lab.testValue) {
          const isAbnormal = (lab.isAbnormal || this.checkAbnormal(lab.testValue, lab.referenceRange)) ? 1 : 0;
          insert.run(
            this.patientId, formatDate(lab.date),
            lab.testName, lab.testValue, lab.unit, lab.referenceRange,
            isAbnormal, this.categorizeTest(lab.testName), 'enabiz'
          );
          saved++;
        }
      }

      console.log(`âœ… ${saved} tahlil sonucu kaydedildi (${labData.length} toplam bulundu)`);
      return { count: saved, data: labData };
    } catch (e) {
      console.error('âŒ Tahlil Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-labs');
      return { count: 0, data: [], error: e.message };
    }
  }

  // API'den gelen JSON objesini normalize et
  normalizeLabItem(item) {
    // E-NabÄ±z API farklÄ± field isimleri kullanabilir - hepsini dene
    const fieldMap = {
      testName: ['TestAdi', 'testAdi', 'TestName', 'testName', 'Adi', 'adi', 'Ad', 'ad', 'name', 'Name',
                  'TetkikAdi', 'tetkikAdi', 'ParametreAdi', 'parametreAdi', 'TahlilAdi', 'tahlilAdi',
                  'BillesimAdi', 'billesimAdi', 'IslemAdi', 'islemAdi'],
      testValue: ['Sonuc', 'sonuc', 'Deger', 'deger', 'Value', 'value', 'Result', 'result',
                   'SonucDeger', 'sonucDeger', 'SonucBilgi', 'sonucBilgi', 'TestSonuc', 'testSonuc'],
      unit: ['Birim', 'birim', 'Unit', 'unit', 'Birimi', 'birimi'],
      referenceRange: ['ReferansAralik', 'referansAralik', 'RefDeger', 'refDeger', 'ReferenceRange',
                        'NormalAralik', 'normalAralik', 'ReferansDeger', 'referansDeger'],
      date: ['Tarih', 'tarih', 'Date', 'date', 'IslemTarihi', 'islemTarihi', 'SonucTarihi',
              'sonucTarihi', 'TestTarihi', 'testTarihi', 'KayitTarihi', 'kayitTarihi']
    };

    const result = {};
    for (const [key, candidates] of Object.entries(fieldMap)) {
      for (const field of candidates) {
        if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
          result[key] = String(item[field]).trim();
          break;
        }
      }
      if (!result[key]) result[key] = '';
    }

    // Nested yapÄ±lar "Sonuclar" arrayÄ± olabilir
    if (!result.testName && item.Sonuclar && Array.isArray(item.Sonuclar)) {
      return item.Sonuclar.map(s => this.normalizeLabItem(s));
    }

    // Obje'yi string olarak da kaydet (hiÃ§ field bulunamazsa)
    if (!result.testName && !result.testValue) {
      const keys = Object.keys(item).filter(k => !['__type', 'Id', 'id'].includes(k));
      result.testName = keys.map(k => `${k}: ${item[k]}`).join(', ').substring(0, 200);
      result.testValue = 'raw-data';
    }

    return result;
  }

  // Genel veri Ã§ekme (reÃ§ete, muayene, radyoloji iÃ§in ortak)
  async fetchSectionData(category, fallbackKeywords, label) {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log(`ðŸ“‹ ${label} Ã§ekiliyor...`);

    try {
      const url = this.navLinks[category] || null;
      let apiResponses = [];

      if (url) {
        apiResponses = await this.fetchWithNetworkCapture(url, category);
      } else {
        const navigated = await this.navigateAndWait(category, fallbackKeywords);
        if (!navigated) {
          console.log(`âš ï¸ ${label} sayfasÄ±na ulaÅŸÄ±lamadÄ±`);
          await this.savePageDebug(`${category}-nav-fail`);
          return [];
        }
      }

      // DOM'dan veri Ã§ek
      const pageContent = await this.extractFullPageContent();
      await this.savePageDebug(category);

      let results = [];

      // 1. API yanÄ±tlarÄ±ndan
      for (const resp of apiResponses) {
        try {
          const parsed = JSON.parse(resp.body);
          const items = Array.isArray(parsed) ? parsed
            : parsed.data ? (Array.isArray(parsed.data) ? parsed.data : [parsed.data])
            : parsed.result ? (Array.isArray(parsed.result) ? parsed.result : [parsed.result])
            : parsed.items ? parsed.items
            : parsed.list ? parsed.list
            : parsed.Model ? (Array.isArray(parsed.Model) ? parsed.Model : [parsed.Model])
            : [];

          if (items.length > 0) {
            console.log(`  âœ… API'den ${items.length} kayÄ±t: ${resp.url.substring(0, 80)}`);
            for (const item of items) {
              results.push({
                text: JSON.stringify(item).substring(0, 1000),
                date: item.Tarih || item.tarih || item.Date || item.date || item.IslemTarihi || '',
                raw: item
              });
            }
          }
        } catch (e) { /* JSON parse hatasÄ± */ }
      }

      // 2. Tablolardan
      if (results.length === 0) {
        for (const table of pageContent.tables) {
          for (const row of table.rows) {
            results.push({
              text: row.join(' | ').substring(0, 500),
              date: row[0] || '' // genelde ilk kolon tarih
            });
          }
        }
      }

      // 3. Text bloklarÄ±ndan
      if (results.length === 0) {
        const meaningful = pageContent.textBlocks.filter(b =>
          b.text.length > 10 &&
          !b.class.includes('nav') &&
          !b.class.includes('menu') &&
          !b.class.includes('footer')
        );
        for (const block of meaningful) {
          results.push({
            text: block.text.substring(0, 500),
            date: ''
          });
        }
      }

      // Debug analiz kaydet
      const debugPath = path.join(__dirname, '..', 'data', `${category}-analysis-${Date.now()}.json`);
      fs.writeFileSync(debugPath, JSON.stringify({
        apiResponses: apiResponses.map(r => ({ url: r.url, size: r.size, bodyPreview: r.body.substring(0, 500) })),
        tables: pageContent.tables,
        textBlocks: pageContent.textBlocks.slice(0, 30),
        structure: pageContent.structure,
        resultCount: results.length
      }, null, 2));

      console.log(`âœ… ${results.length} ${label} kaydÄ± bulundu`);
      return results;
    } catch (e) {
      console.error(`âŒ ${label} hatasÄ±:`, e.message);
      await this.savePageDebug(`error-${category}`);
      return [];
    }
  }

  // ReÃ§eteleri Ã§ek â€” her reÃ§etenin ilaÃ§ detaylarÄ±nÄ± da Ã§ek ve DB'ye kaydet
  async fetchPrescriptions() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ’Š ReÃ§eteler Ã§ekiliyor (ilaÃ§ detaylarÄ± dahil)...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const url = this.navLinks.prescriptions || `${ENABIZ_URL}/Home/Recetelerim`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniÅŸ aralÄ±ÄŸa ayarla
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            await startYearSelect.selectOption(years[years.length - 1]);
          }
        }
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { /* filtre yok veya hata */ }

      // DataTable'dan reÃ§eteleri + detay butonundaki parametreleri Ã§ek
      const prescriptions = await this.page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('#recetelerTbody tr, #tbl-recetelerim tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            // Detay butonundan parametreleri Ã§Ä±kar
            const detayBtn = row.querySelector('a[onclick*="ReceteDetayGoster"]');
            let sysTakipNo = '', receteNo = '', doctor = '', type = '';
            if (detayBtn) {
              const onclick = detayBtn.getAttribute('onclick') || '';
              const match = onclick.match(/ReceteDetayGoster\('([^']+)','([^']+)','([^']+)','([^']+)'\)/);
              if (match) {
                sysTakipNo = match[1];
                receteNo = match[2];
                doctor = match[3];
                type = match[4];
              }
            }
            results.push({
              date: cells[0]?.textContent?.trim() || '',
              prescriptionNo: receteNo || cells[1]?.textContent?.trim() || '',
              type: type || cells[2]?.textContent?.trim() || '',
              doctor: doctor || cells[3]?.textContent?.trim() || '',
              sysTakipNo
            });
          }
        }
        return results;
      });

      console.log(`  ðŸ“‹ ${prescriptions.length} reÃ§ete bulundu, ilaÃ§ detaylarÄ± Ã§ekiliyor...`);

      // Her reÃ§etenin ilaÃ§ detayÄ±nÄ± Ã§ek (API Ã§aÄŸrÄ±sÄ± ile)
      const allMedications = [];
      for (const rx of prescriptions) {
        if (rx.sysTakipNo && rx.prescriptionNo) {
          try {
            const detailUrl = `${ENABIZ_URL}/Recete/GetReceteDetay?data={"SYSTakipNo":"${rx.sysTakipNo}","ReceteNo":"${rx.prescriptionNo}"}`;
            const detailHtml = await this.page.evaluate(async (url) => {
              const resp = await fetch(url, { method: 'POST', credentials: 'include' });
              return resp.ok ? await resp.text() : '';
            }, detailUrl);

            if (detailHtml) {
              // HTML'den ilaÃ§ tablosunu parse et
              const meds = await this.page.evaluate((html) => {
                const div = document.createElement('div');
                div.innerHTML = html;
                const medications = [];

                // tbl-RecetedeYazanÄ°laclar tablosu â€” yazÄ±lan ilaÃ§lar
                const rows = div.querySelectorAll('table tbody tr');
                for (const row of rows) {
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 2) {
                    const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
                    // Ä°laÃ§ adÄ± genelde ilk veya ikinci kolonda
                    const drugName = texts.find(t => t.length > 3 && !t.match(/^\d+$/) && !t.match(/^\d{2}\.\d{2}\.\d{4}$/)) || '';
                    if (drugName) {
                      medications.push({
                        name: drugName,
                        allCells: texts
                      });
                    }
                  }
                }

                // AyrÄ±ca tÃ¼m text'i de sakla (detaylÄ± analiz iÃ§in)
                const fullText = div.textContent?.replace(/\s+/g, ' ').trim() || '';

                return { medications, fullText: fullText.substring(0, 3000) };
              }, detailHtml);

              if (meds.medications.length > 0) {
                for (const med of meds.medications) {
                  allMedications.push({
                    ...med,
                    prescriptionNo: rx.prescriptionNo,
                    date: rx.date,
                    doctor: rx.doctor,
                    type: rx.type
                  });
                }
                console.log(`    ðŸ’Š ReÃ§ete ${rx.prescriptionNo}: ${meds.medications.length} ilaÃ§`);
              }

              // Detay HTML'i debug olarak kaydet (ilk reÃ§ete)
              if (allMedications.length <= 5) {
                const debugPath = path.join(__dirname, '..', 'data', `prescription-detail-${rx.prescriptionNo}.html`);
                fs.writeFileSync(debugPath, detailHtml);
              }

              // ReÃ§ete event'ini kur â€” tÃ¼m ilaÃ§ listesi dahil
              rx.medications = meds.medications;
              rx.detailText = meds.fullText;
            }
          } catch (e) {
            console.log(`    âš ï¸ ReÃ§ete ${rx.prescriptionNo} detay alÄ±namadÄ±: ${e.message}`);
          }
          await this.page.waitForTimeout(500); // Rate limiting
        }
      }

      await this.savePageDebug('prescriptions');

      // DB â€” medical_events tablosuna reÃ§ete + ilaÃ§ detay bilgisi ile kaydet
      const insertEvent = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      // DB â€” medications tablosuna her ilacÄ± ekle
      const insertMed = db.prepare(
        'INSERT OR IGNORE INTO medications (patient_id, name, dosage, frequency, start_date, prescribed_by, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );

      for (const rx of prescriptions) {
        if (rx.date) {
          const medNames = (rx.medications || []).map(m => m.name).join(', ');
          insertEvent.run(
            this.patientId, formatDate(rx.date),
            'prescription',
            `ReÃ§ete ${rx.prescriptionNo} - ${rx.type}`,
            `Hekim: ${rx.doctor} | ReÃ§ete No: ${rx.prescriptionNo} | TÃ¼r: ${rx.type}${medNames ? ' | Ä°laÃ§lar: ' + medNames : ''}`,
            JSON.stringify({ medications: rx.medications || [], detailText: rx.detailText || '' }),
            'enabiz'
          );
        }
      }

      // Her ilacÄ± medications tablosuna ekle
      for (const med of allMedications) {
        insertMed.run(
          this.patientId,
          med.name,
          med.allCells?.join(' | ') || '', // dosage - tÃ¼m hÃ¼creleri birleÅŸtir
          '', // frequency
          formatDate(med.date),
          med.doctor,
          `ReÃ§ete: ${med.prescriptionNo} | TÃ¼r: ${med.type}`,
          1
        );
      }

      console.log(`âœ… ${prescriptions.length} reÃ§ete + ${allMedications.length} ilaÃ§ detayÄ± kaydedildi`);
      return { prescriptions, medications: allMedications };
    } catch (e) {
      console.error('âŒ ReÃ§ete Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-prescriptions');
      return { prescriptions: [], medications: [] };
    }
  }

  // Muayene/Randevu geÃ§miÅŸini Ã§ek ve DB'ye kaydet
  async fetchVisitHistory() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ¥ Muayene/randevu geÃ§miÅŸi Ã§ekiliyor...');

    try {
      const url = this.navLinks.visits || `${ENABIZ_URL}/Home/Randevularim`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // DataTable'dan randevularÄ± Ã§ek
      const visits = await this.page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('#RandevuListeData tr, #tblRandevuListesi tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 5) {
            const status = row.querySelector('.randevuDurum')?.textContent?.trim() || '';
            results.push({
              date: cells[1]?.textContent?.trim() || '',
              hospital: cells[2]?.textContent?.trim() || '',
              clinic: cells[3]?.textContent?.trim() || '',
              location: cells[4]?.textContent?.trim() || '',
              doctor: cells[5]?.textContent?.trim() || '',
              status
            });
          }
        }
        return results;
      });

      await this.savePageDebug('visits');

      // DB'ye kaydet
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, source) VALUES (?, ?, ?, ?, ?, ?)'
      );

      for (const visit of visits) {
        if (visit.date) {
          const dateStr = visit.date.split(' ')[0]; // "2026-03-09 15:10:00" â†’ "2026-03-09"
          insert.run(
            this.patientId, dateStr,
            'appointment',
            `${visit.clinic} - ${visit.hospital}`,
            `Klinik: ${visit.clinic} | Yer: ${visit.location} | Hekim: ${visit.doctor} | Durum: ${visit.status} | Hastane: ${visit.hospital}`,
            'enabiz'
          );
        }
      }

      console.log(`âœ… ${visits.length} muayene/randevu kaydedildi`);
      return visits;
    } catch (e) {
      console.error('âŒ Muayene Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-visits');
      return [];
    }
  }

  // Radyoloji raporlarÄ±nÄ± Ã§ek â€” rapor metni ve gÃ¶rÃ¼ntÃ¼ linkleri dahil
  async fetchRadiology() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ“· Radyoloji raporlarÄ± Ã§ekiliyor (detaylÄ±)...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const url = this.navLinks.radiology || `${ENABIZ_URL}/Home/RadyolojikGoruntulerim`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniÅŸ aralÄ±ÄŸa ayarla
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            await startYearSelect.selectOption(years[years.length - 1]);
          }
        }
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { /* filtre yok veya hata */ }

      // Radyoloji kartlarÄ±ndan veri + detay parametrelerini Ã§ek
      const radiology = await this.page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll('.radyolojiCardListe, .radyolojiCardContainer .card');
        for (const card of cards) {
          const hospital = card.querySelector('.RhastaneAdi')?.textContent?.trim() || '';
          const dateEl = card.querySelector('.Rtarih span');
          const date = dateEl?.textContent?.trim() || '';
          const descEl = card.querySelector('.Raciklama');
          let description = '';
          if (descEl) {
            description = descEl.textContent?.trim() || '';
            description = description.replace(/^AÃ§Ä±klama\s*:\s*/i, '').trim();
          }

          // showHtmlReport encrypted ID'sini Ã§ek
          let encryptedId = '';
          const reportBtn = card.querySelector('a[onclick*="showHtmlReport"], button[onclick*="showHtmlReport"]');
          if (reportBtn) {
            const onclick = reportBtn.getAttribute('onclick') || '';
            const match = onclick.match(/showHtmlReport\('([^']+)'\)/);
            if (match) encryptedId = match[1];
          }

          // openImageLink image ID'sini Ã§ek
          let imageId = '';
          const imageBtn = card.querySelector('a[onclick*="openImageLink"], button[onclick*="openImageLink"]');
          if (imageBtn) {
            const onclick = imageBtn.getAttribute('onclick') || '';
            const match = onclick.match(/openImageLink\('([^']+)'\)/);
            if (match) imageId = match[1];
          }

          // Thumbnail/base64 gÃ¶rsel varsa
          const thumbnail = card.querySelector('img[src*="data:image"]')?.getAttribute('src') || '';

          if (date || description) {
            results.push({ date, hospital, description, encryptedId, imageId, hasThumbnail: !!thumbnail, thumbnailData: thumbnail });
          }
        }
        return results;
      });

      console.log(`  ðŸ“‹ ${radiology.length} radyoloji kaydÄ± bulundu, rapor detaylarÄ± Ã§ekiliyor...`);

      // Her kart iÃ§in rapor metnini Ã§ek (showHtmlReport API'si ile)
      for (const rad of radiology) {
        if (rad.encryptedId) {
          try {
            // RadyolojiApp.showHtmlReport Ã§aÄŸrÄ±sÄ±nÄ± simulate et
            const reportText = await this.page.evaluate(async (encId) => {
              try {
                // E-NabÄ±z'Ä±n kullandÄ±ÄŸÄ± API endpoint'ini Ã§aÄŸÄ±r
                const resp = await fetch('/RadyolojikGoruntu/GetHtmlReport?encryptedId=' + encId, {
                  method: 'GET',
                  credentials: 'include'
                });
                if (resp.ok) {
                  const html = await resp.text();
                  // HTML'den saf metin Ã§Ä±kar
                  const div = document.createElement('div');
                  div.innerHTML = html;
                  return {
                    text: div.textContent?.replace(/\s+/g, ' ').trim().substring(0, 5000) || '',
                    html: html.substring(0, 10000)
                  };
                }
              } catch (e) {}

              // Alternatif endpoint dene
              try {
                const resp2 = await fetch('/Home/GetRadyolojiRapor?id=' + encId, {
                  method: 'GET',
                  credentials: 'include'
                });
                if (resp2.ok) {
                  const html = await resp2.text();
                  const div = document.createElement('div');
                  div.innerHTML = html;
                  return {
                    text: div.textContent?.replace(/\s+/g, ' ').trim().substring(0, 5000) || '',
                    html: html.substring(0, 10000)
                  };
                }
              } catch (e) {}

              return null;
            }, rad.encryptedId);

            if (reportText && reportText.text) {
              rad.reportText = reportText.text;
              rad.reportHtml = reportText.html;
              console.log(`    ðŸ“„ Rapor alÄ±ndÄ±: ${rad.description.substring(0, 50)}... (${reportText.text.length} karakter)`);

              // Ä°lk rapor HTML'ini debug olarak kaydet
              const debugPath = path.join(__dirname, '..', 'data', `radiology-report-${rad.encryptedId.substring(0, 10)}.html`);
              fs.writeFileSync(debugPath, reportText.html || '');
            }
          } catch (e) {
            console.log(`    âš ï¸ Rapor alÄ±namadÄ±: ${e.message}`);
          }
          await this.page.waitForTimeout(500);
        }

        // Alternatif: showHtmlReport'u DOM Ã¼zerinden Ã§aÄŸÄ±r (modal aÃ§arak)
        if (!rad.reportText && rad.encryptedId) {
          try {
            await this.page.evaluate((encId) => {
              if (typeof RadyolojiApp !== 'undefined' && RadyolojiApp.showHtmlReport) {
                RadyolojiApp.showHtmlReport(encId);
              }
            }, rad.encryptedId);
            await this.page.waitForTimeout(2000);

            // Modal aÃ§Ä±ldÄ±ysa iÃ§eriÄŸini oku
            const modalText = await this.page.evaluate(() => {
              const modal = document.querySelector('#radyolojikGoruntuDetayModal, .modal.show, .modal[style*="display: block"]');
              if (modal) {
                const text = modal.textContent?.replace(/\s+/g, ' ').trim() || '';
                // ModalÄ± kapat
                const closeBtn = modal.querySelector('.btn-close, [data-bs-dismiss="modal"], .close');
                if (closeBtn) closeBtn.click();
                return text.substring(0, 5000);
              }
              return '';
            });

            if (modalText && modalText.length > 50) {
              rad.reportText = modalText;
              console.log(`    ðŸ“„ Rapor (modal): ${rad.description.substring(0, 50)}... (${modalText.length} karakter)`);
            }
          } catch (e) { /* modal yÃ¶ntemi baÅŸarÄ±sÄ±z */ }
        }
      }

      await this.savePageDebug('radiology');

      // DB'ye kaydet (medical_events tablosuna) â€” rapor metni dahil
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const rad of radiology) {
        if (rad.description) {
          insert.run(
            this.patientId, formatDate(rad.date),
            'radiology',
            `Radyoloji - ${rad.description.substring(0, 100)}`,
            `${rad.description} | Hastane: ${rad.hospital}${rad.reportText ? '\n\n--- RAPOR METNÄ° ---\n' + rad.reportText : ''}`,
            JSON.stringify({
              encryptedId: rad.encryptedId || '',
              imageId: rad.imageId || '',
              reportText: rad.reportText || '',
              hasThumbnail: rad.hasThumbnail || false,
              thumbnailData: rad.thumbnailData || ''
            }),
            'enabiz'
          );
        }
      }

      const withReport = radiology.filter(r => r.reportText).length;
      console.log(`âœ… ${radiology.length} radyoloji raporu kaydedildi (${withReport} adet rapor metni ile)`);
      return radiology;
    } catch (e) {
      console.error('âŒ Radyoloji Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-radiology');
      return [];
    }
  }

  // Epikriz (Taburculuk/Ã‡Ä±kÄ±ÅŸ Ã–zetleri) Ã§ek â€” kanser tedavi geÃ§miÅŸi iÃ§in kritik
  async fetchEpikriz() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ“‹ Epikriz (taburculuk Ã¶zetleri) Ã§ekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      await this.page.goto(`${ENABIZ_URL}/Home/Epikrizlerim`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniÅŸ aralÄ±ÄŸa ayarla
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            await startYearSelect.selectOption(years[years.length - 1]);
          }
        }
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { /* filtre yok veya hata */ }

      await this.savePageDebug('epikriz');

      // Sayfa yapÄ±sÄ±nÄ± keÅŸfet â€” epikriz listesi genelde DataTable veya card formatÄ±nda
      const epicrises = await this.page.evaluate(() => {
        const results = [];

        // DataTable formatÄ±
        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            // Detay butonu varsa onclick'ini al
            const detailBtn = row.querySelector('a[onclick], button[onclick]');
            let detailOnclick = '';
            if (detailBtn) {
              detailOnclick = detailBtn.getAttribute('onclick') || '';
            }
            // SatÄ±r tÄ±klanabilir mi?
            const rowOnclick = row.getAttribute('onclick') || '';

            results.push({
              cellTexts: texts,
              detailOnclick,
              rowOnclick,
              fullRowText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        // Card / Accordion formatÄ±
        const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item');
        for (const card of cards) {
          const text = card.textContent?.trim() || '';
          if (text.length > 20 && !results.some(r => r.fullRowText === text.substring(0, 500))) {
            const detailBtn = card.querySelector('a[onclick], button[onclick], a[href*="Epikriz"]');
            let detailOnclick = '';
            let detailHref = '';
            if (detailBtn) {
              detailOnclick = detailBtn.getAttribute('onclick') || '';
              detailHref = detailBtn.getAttribute('href') || '';
            }
            results.push({
              cellTexts: [text.substring(0, 200)],
              detailOnclick,
              detailHref,
              fullRowText: text.substring(0, 500)
            });
          }
        }

        // TÃ¼m sayfayÄ± al (eÄŸer yapÄ± farklÄ±ysa)
        const pageText = document.querySelector('.content-area, .main-content, #content, main, [role="main"]')?.textContent?.trim().substring(0, 5000) || '';

        return { items: results, pageText };
      });

      console.log(`  ðŸ“‹ ${epicrises.items.length} epikriz kaydÄ± bulundu`);

      // Her epikriz detayÄ±na tÄ±klayÄ±p iÃ§eriÄŸi Ã§ek
      for (let i = 0; i < epicrises.items.length; i++) {
        const ep = epicrises.items[i];
        // Detay linkine tÄ±kla eÄŸer varsa
        if (ep.detailOnclick || ep.rowOnclick || ep.detailHref) {
          try {
            if (ep.detailHref && ep.detailHref.startsWith('/')) {
              // Link'e git
              await this.page.goto(`${ENABIZ_URL}${ep.detailHref}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await this.page.waitForTimeout(2000);
              ep.detailContent = await this.page.evaluate(() =>
                document.body.textContent?.replace(/\s+/g, ' ').trim().substring(0, 5000) || ''
              );
              await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
              await this.page.waitForTimeout(2000);
            } else {
              // Onclick Ã§aÄŸÄ±r ve modal/panel bekle
              const onclick = ep.detailOnclick || ep.rowOnclick;
              if (onclick) {
                await this.page.evaluate((fn) => { try { eval(fn); } catch(e){} }, onclick);
                await this.page.waitForTimeout(2000);
                ep.detailContent = await this.page.evaluate(() => {
                  const modal = document.querySelector('.modal.show, .modal[style*="display: block"], .offcanvas.show');
                  if (modal) {
                    const text = modal.textContent?.replace(/\s+/g, ' ').trim() || '';
                    const closeBtn = modal.querySelector('.btn-close, [data-bs-dismiss="modal"], .close');
                    if (closeBtn) closeBtn.click();
                    return text.substring(0, 5000);
                  }
                  return '';
                });
              }
            }
            if (ep.detailContent) {
              console.log(`    ðŸ“„ Epikriz detayÄ± alÄ±ndÄ± (${ep.detailContent.length} karakter)`);
            }
          } catch (e) {
            console.log(`    âš ï¸ Epikriz detayÄ± alÄ±namadÄ±: ${e.message}`);
          }
        }
      }

      // DB'ye kaydet
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      let saved = 0;
      for (const ep of epicrises.items) {
        // Tarih Ã§Ä±karmaya Ã§alÄ±ÅŸ
        const dateMatch = ep.fullRowText.match(/(\d{2}\.\d{2}\.\d{4})/);
        const date = dateMatch ? formatDate(dateMatch[1]) : new Date().toISOString().split('T')[0];
        const title = ep.cellTexts[0]?.substring(0, 100) || 'Epikriz';

        if (ep.fullRowText.length > 10) {
          insert.run(
            this.patientId, date,
            'epicrisis',
            `Epikriz - ${title}`,
            ep.detailContent || ep.fullRowText,
            JSON.stringify({ cellTexts: ep.cellTexts }),
            'enabiz'
          );
          saved++;
        }
      }

      // EÄŸer hiÃ§ kayÄ±t bulunamadÄ±ysa sayfa metnini kaydet (yapÄ± analizi iÃ§in)
      if (saved === 0 && epicrises.pageText && epicrises.pageText.length > 50) {
        insert.run(
          this.patientId, new Date().toISOString().split('T')[0],
          'epicrisis',
          'Epikriz SayfasÄ± Ä°Ã§eriÄŸi',
          epicrises.pageText,
          JSON.stringify({ raw: true }),
          'enabiz'
        );
        saved = 1;
      }

      console.log(`âœ… ${saved} epikriz kaydedildi`);
      return epicrises.items;
    } catch (e) {
      console.error('âŒ Epikriz Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-epikriz');
      return [];
    }
  }

  // TÄ±bbi Raporlar (RaporlarÄ±m sayfasÄ±) Ã§ek
  async fetchReports() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ“‘ TÄ±bbi raporlar Ã§ekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      await this.page.goto(`${ENABIZ_URL}/Home/Raporlarim`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniÅŸ aralÄ±ÄŸa ayarla
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            await startYearSelect.selectOption(years[years.length - 1]);
          }
        }
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { /* filtre yok veya hata */ }

      await this.savePageDebug('reports');

      // Sayfa yapÄ±sÄ±nÄ± keÅŸfet
      const reports = await this.page.evaluate(() => {
        const results = [];

        // DataTable formatÄ±
        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            const detailBtn = row.querySelector('a[onclick], button[onclick], a[href*="Rapor"]');
            let detailOnclick = '';
            let detailHref = '';
            if (detailBtn) {
              detailOnclick = detailBtn.getAttribute('onclick') || '';
              detailHref = detailBtn.getAttribute('href') || '';
            }
            results.push({
              cellTexts: texts,
              detailOnclick,
              detailHref,
              fullRowText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        // Card / List formatÄ±
        const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item');
        for (const card of cards) {
          const text = card.textContent?.trim() || '';
          if (text.length > 20 && !results.some(r => r.fullRowText === text.substring(0, 500))) {
            const detailBtn = card.querySelector('a[onclick], button[onclick], a[href*="Rapor"]');
            let detailOnclick = '';
            let detailHref = '';
            if (detailBtn) {
              detailOnclick = detailBtn.getAttribute('onclick') || '';
              detailHref = detailBtn.getAttribute('href') || '';
            }
            results.push({
              cellTexts: [text.substring(0, 200)],
              detailOnclick,
              detailHref,
              fullRowText: text.substring(0, 500)
            });
          }
        }

        const pageText = document.querySelector('.content-area, .main-content, #content, main, [role="main"]')?.textContent?.trim().substring(0, 5000) || '';

        return { items: results, pageText };
      });

      console.log(`  ðŸ“‹ ${reports.items.length} rapor kaydÄ± bulundu`);

      // Her rapor detayÄ±na tÄ±klayÄ±p iÃ§eriÄŸi Ã§ek
      for (let i = 0; i < reports.items.length; i++) {
        const rp = reports.items[i];
        if (rp.detailOnclick || rp.detailHref) {
          try {
            if (rp.detailHref && rp.detailHref.startsWith('/')) {
              await this.page.goto(`${ENABIZ_URL}${rp.detailHref}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await this.page.waitForTimeout(2000);
              rp.detailContent = await this.page.evaluate(() =>
                document.body.textContent?.replace(/\s+/g, ' ').trim().substring(0, 5000) || ''
              );
              await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
              await this.page.waitForTimeout(2000);
            } else if (rp.detailOnclick) {
              await this.page.evaluate((fn) => { try { eval(fn); } catch(e){} }, rp.detailOnclick);
              await this.page.waitForTimeout(2000);
              rp.detailContent = await this.page.evaluate(() => {
                const modal = document.querySelector('.modal.show, .modal[style*="display: block"], .offcanvas.show');
                if (modal) {
                  const text = modal.textContent?.replace(/\s+/g, ' ').trim() || '';
                  const closeBtn = modal.querySelector('.btn-close, [data-bs-dismiss="modal"], .close');
                  if (closeBtn) closeBtn.click();
                  return text.substring(0, 5000);
                }
                return '';
              });
            }
            if (rp.detailContent) {
              console.log(`    ðŸ“„ Rapor detayÄ± alÄ±ndÄ± (${rp.detailContent.length} karakter)`);
            }
          } catch (e) {
            console.log(`    âš ï¸ Rapor detayÄ± alÄ±namadÄ±: ${e.message}`);
          }
        }
      }

      // DB'ye kaydet
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      let saved = 0;
      for (const rp of reports.items) {
        const dateMatch = rp.fullRowText.match(/(\d{2}\.\d{2}\.\d{4})/);
        const date = dateMatch ? formatDate(dateMatch[1]) : new Date().toISOString().split('T')[0];
        const title = rp.cellTexts[0]?.substring(0, 100) || 'Rapor';

        if (rp.fullRowText.length > 10) {
          insert.run(
            this.patientId, date,
            'report',
            `Rapor - ${title}`,
            rp.detailContent || rp.fullRowText,
            JSON.stringify({ cellTexts: rp.cellTexts }),
            'enabiz'
          );
          saved++;
        }
      }

      if (saved === 0 && reports.pageText && reports.pageText.length > 50) {
        insert.run(
          this.patientId, new Date().toISOString().split('T')[0],
          'report',
          'RaporlarÄ±m SayfasÄ± Ä°Ã§eriÄŸi',
          reports.pageText,
          JSON.stringify({ raw: true }),
          'enabiz'
        );
        saved = 1;
      }

      console.log(`âœ… ${saved} rapor kaydedildi`);
      return reports.items;
    } catch (e) {
      console.error('âŒ Rapor Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-reports');
      return [];
    }
  }

  // Debug: Sayfa yapÄ±sÄ±nÄ± kaydet (screenshot + FULL HTML)
  async savePageDebug(label) {
    try {
      const timestamp = Date.now();
      const ssPath = path.join(__dirname, '..', 'data', `page-${label}-${timestamp}.png`);
      await this.page.screenshot({ path: ssPath, fullPage: true });

      // Tam body HTML kaydet (eski gibi kÃ¼Ã§Ã¼k bir selector deÄŸil)
      const html = await this.page.evaluate(() => document.body.innerHTML.substring(0, 200000));
      const htmlPath = path.join(__dirname, '..', 'data', `page-${label}-${timestamp}.html`);
      fs.writeFileSync(htmlPath, html);

      console.log(`ðŸ“¸ Debug kaydedildi: ${ssPath}`);
      return { screenshot: ssPath, html: htmlPath };
    } catch (e) {
      console.error('ðŸ“¸ Debug kayÄ±t hatasÄ±:', e.message);
      return null;
    }
  }

  // TÃ¼m verileri Ã§ek (A'dan Z'ye)
  async fetchAll() {
    console.log('\nðŸ”„ TÃ¼m E-NabÄ±z verileri Ã§ekiliyor (detaylÄ±)...\n');

    // Ã–nce navigasyon linklerini keÅŸfet
    await this.discoverNavLinks();

    const results = {};
    results.labs = await this.fetchLabResults();
    results.prescriptions = await this.fetchPrescriptions();
    results.visits = await this.fetchVisitHistory();
    results.radiology = await this.fetchRadiology();
    results.epicrisis = await this.fetchEpikriz();
    results.reports = await this.fetchReports();
    results.allergies = await this.fetchAllergies();
    results.vaccines = await this.fetchVaccines();
    results.chronicDiseases = await this.fetchChronicDiseases();
    results.surgeries = await this.fetchSurgeries();
    results.diagnoses = await this.fetchDiagnoses();

    // Sync log
    const rxCount = results.prescriptions?.prescriptions?.length || 0;
    const medCount = results.prescriptions?.medications?.length || 0;
    db.prepare(
      'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(this.patientId, new Date().toISOString().split('T')[0], 'note',
      'E-NabÄ±z Veri Senkronizasyonu (KapsamlÄ±)',
      `Tahlil: ${results.labs.count || 0}, ReÃ§ete: ${rxCount} (${medCount} ilaÃ§), Muayene: ${results.visits.length}, Radyoloji: ${results.radiology.length}, Epikriz: ${results.epicrisis.length}, Rapor: ${results.reports.length}, Alerji: ${results.allergies.length}, AÅŸÄ±: ${results.vaccines.length}, Kronik: ${results.chronicDiseases.length}, Ameliyat: ${results.surgeries.length}, TanÄ±: ${results.diagnoses.length}`,
      'system');

    console.log('\nâœ… E-NabÄ±z senkronizasyonu tamamlandÄ± (kapsamlÄ±)\n');
    return results;
  }

  // ============ YENÄ° VERÄ° Ã‡EKME FONKSÄ°YONLARI ============

  // Alerji bilgilerini Ã§ek
  async fetchAllergies() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ¤§ Alerji bilgileri Ã§ekiliyor...');

    try {
      const navigated = await this.navigateToSection('allergies', ['Alerjilerim', 'Alerji', 'Alerjiler']);
      if (!navigated) {
        console.log('âš ï¸ Alerji sayfasÄ±na ulaÅŸÄ±lamadÄ±, atlanÄ±yor');
        return [];
      }

      const allergies = await this.page.evaluate(() => {
        const results = [];

        // Tablo formatÄ±
        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            results.push({
              allergen: texts[0] || '',
              type: texts[1] || '',
              severity: texts[2] || '',
              reaction: texts[3] || '',
              date: texts[4] || '',
              fullText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        // Card / list formatÄ±
        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item, .alerjiCard');
          for (const card of cards) {
            const text = card.textContent?.trim() || '';
            if (text.length > 5) {
              results.push({
                allergen: text.substring(0, 100),
                fullText: text.substring(0, 500)
              });
            }
          }
        }

        // Sayfa iÃ§eriÄŸini al (yapÄ± farklÄ±ysa)
        if (results.length === 0) {
          const pageText = document.querySelector('.content-area, .main-content, #content, main, [role="main"]')?.textContent?.trim() || '';
          if (pageText.length > 30) {
            results.push({ allergen: 'Sayfa Ä°Ã§eriÄŸi', fullText: pageText.substring(0, 2000) });
          }
        }

        return results;
      });

      await this.savePageDebug('allergies');

      // DB'ye kaydet
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const a of allergies) {
        if (a.allergen && a.allergen !== 'Sayfa Ä°Ã§eriÄŸi') {
          insert.run(
            this.patientId, new Date().toISOString().split('T')[0],
            'allergy',
            `Alerji - ${a.allergen.substring(0, 100)}`,
            `Alerjen: ${a.allergen}${a.type ? ' | TÃ¼r: ' + a.type : ''}${a.severity ? ' | Åžiddet: ' + a.severity : ''}${a.reaction ? ' | Reaksiyon: ' + a.reaction : ''}`,
            JSON.stringify(a),
            'enabiz'
          );
        }
      }

      console.log(`âœ… ${allergies.length} alerji kaydedildi`);
      return allergies;
    } catch (e) {
      console.error('âŒ Alerji Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-allergies');
      return [];
    }
  }

  // AÅŸÄ± kayÄ±tlarÄ±nÄ± Ã§ek
  async fetchVaccines() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ’‰ AÅŸÄ± kayÄ±tlarÄ± Ã§ekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const navigated = await this.navigateToSection('vaccines', ['AÅŸÄ± Takvimi', 'AÅŸÄ±larÄ±m', 'AÅŸÄ±', 'AsiTakvimi']);
      if (!navigated) {
        console.log('âš ï¸ AÅŸÄ± sayfasÄ±na ulaÅŸÄ±lamadÄ±, atlanÄ±yor');
        return [];
      }

      const vaccines = await this.page.evaluate(() => {
        const results = [];

        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            results.push({
              name: texts[0] || '',
              date: texts[1] || '',
              dose: texts[2] || '',
              institution: texts[3] || '',
              fullText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item');
          for (const card of cards) {
            const text = card.textContent?.trim() || '';
            if (text.length > 5) {
              results.push({
                name: text.substring(0, 100),
                fullText: text.substring(0, 500)
              });
            }
          }
        }

        return results;
      });

      await this.savePageDebug('vaccines');

      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const v of vaccines) {
        if (v.name) {
          insert.run(
            this.patientId, formatDate(v.date),
            'vaccine',
            `AÅŸÄ± - ${v.name.substring(0, 100)}`,
            `AÅŸÄ±: ${v.name}${v.dose ? ' | Doz: ' + v.dose : ''}${v.institution ? ' | Kurum: ' + v.institution : ''}`,
            JSON.stringify(v),
            'enabiz'
          );
        }
      }

      console.log(`âœ… ${vaccines.length} aÅŸÄ± kaydedildi`);
      return vaccines;
    } catch (e) {
      console.error('âŒ AÅŸÄ± Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-vaccines');
      return [];
    }
  }

  // Kronik hastalÄ±klarÄ± Ã§ek
  async fetchChronicDiseases() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ©º Kronik hastalÄ±klar Ã§ekiliyor...');

    try {
      const navigated = await this.navigateToSection('chronic', ['HastalÄ±klarÄ±m', 'Kronik', 'HastalÄ±klarÄ±m']);
      if (!navigated) {
        console.log('âš ï¸ HastalÄ±k sayfasÄ±na ulaÅŸÄ±lamadÄ±, atlanÄ±yor');
        return [];
      }

      const diseases = await this.page.evaluate(() => {
        const results = [];

        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            results.push({
              name: texts[0] || '',
              icdCode: texts[1] || '',
              startDate: texts[2] || '',
              institution: texts[3] || '',
              fullText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item');
          for (const card of cards) {
            const text = card.textContent?.trim() || '';
            if (text.length > 5) {
              results.push({
                name: text.substring(0, 100),
                fullText: text.substring(0, 500)
              });
            }
          }
        }

        return results;
      });

      await this.savePageDebug('chronic-diseases');

      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const d of diseases) {
        if (d.name) {
          insert.run(
            this.patientId, new Date().toISOString().split('T')[0],
            'chronic_disease',
            `Kronik HastalÄ±k - ${d.name.substring(0, 100)}`,
            `HastalÄ±k: ${d.name}${d.icdCode ? ' | ICD: ' + d.icdCode : ''}${d.startDate ? ' | BaÅŸlangÄ±Ã§: ' + d.startDate : ''}${d.institution ? ' | Kurum: ' + d.institution : ''}`,
            JSON.stringify(d),
            'enabiz'
          );
        }
      }

      console.log(`âœ… ${diseases.length} kronik hastalÄ±k kaydedildi`);
      return diseases;
    } catch (e) {
      console.error('âŒ Kronik hastalÄ±k Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-chronic');
      return [];
    }
  }

  // Ameliyat kayÄ±tlarÄ±nÄ± Ã§ek
  async fetchSurgeries() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ”ª Ameliyat kayÄ±tlarÄ± Ã§ekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const navigated = await this.navigateToSection('surgeries', ['AmeliyatlarÄ±m', 'Ameliyat', 'Ameliyatlar', 'Cerrahi']);
      if (!navigated) {
        console.log('âš ï¸ Ameliyat sayfasÄ±na ulaÅŸÄ±lamadÄ±, atlanÄ±yor');
        return [];
      }

      const surgeries = await this.page.evaluate(() => {
        const results = [];

        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            const detailBtn = row.querySelector('a[onclick], button[onclick]');
            results.push({
              name: texts[0] || '',
              date: texts[1] || '',
              hospital: texts[2] || '',
              doctor: texts[3] || '',
              detailOnclick: detailBtn?.getAttribute('onclick') || '',
              fullText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item');
          for (const card of cards) {
            const text = card.textContent?.trim() || '';
            if (text.length > 5) {
              results.push({
                name: text.substring(0, 100),
                fullText: text.substring(0, 500)
              });
            }
          }
        }

        return results;
      });

      await this.savePageDebug('surgeries');

      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const s of surgeries) {
        if (s.name) {
          insert.run(
            this.patientId, formatDate(s.date),
            'surgery_record',
            `Ameliyat - ${s.name.substring(0, 100)}`,
            `Ameliyat: ${s.name}${s.hospital ? ' | Hastane: ' + s.hospital : ''}${s.doctor ? ' | Hekim: ' + s.doctor : ''}`,
            JSON.stringify(s),
            'enabiz'
          );
        }
      }

      console.log(`âœ… ${surgeries.length} ameliyat kaydedildi`);
      return surgeries;
    } catch (e) {
      console.error('âŒ Ameliyat Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-surgeries');
      return [];
    }
  }

  // TanÄ±/ICD kodlarÄ± Ã§ek
  async fetchDiagnoses() {
    if (!this.isLoggedIn) throw new Error('Ã–nce giriÅŸ yapÄ±n');
    console.log('ðŸ” TanÄ±/ICD kayÄ±tlarÄ± Ã§ekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const navigated = await this.navigateToSection('diagnoses', ['HastalÄ±klarÄ±m', 'TanÄ±', 'HastalÄ±klarÄ±m']);
      if (!navigated) {
        console.log('âš ï¸ TanÄ± sayfasÄ±na ulaÅŸÄ±lamadÄ±, atlanÄ±yor');
        return [];
      }

      // Tarih filtresini en geniÅŸ aralÄ±ÄŸa ayarla
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            await startYearSelect.selectOption(years[years.length - 1]);
          }
        }
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { /* filtre yok */ }

      const diagnoses = await this.page.evaluate(() => {
        const results = [];

        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            results.push({
              icdCode: texts[0] || '',
              name: texts[1] || '',
              date: texts[2] || '',
              hospital: texts[3] || '',
              doctor: texts[4] || '',
              type: texts[5] || '',
              fullText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .accordion-item, .list-group-item');
          for (const card of cards) {
            const text = card.textContent?.trim() || '';
            if (text.length > 5) {
              results.push({
                name: text.substring(0, 100),
                fullText: text.substring(0, 500)
              });
            }
          }
        }

        return results;
      });

      await this.savePageDebug('diagnoses');

      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const d of diagnoses) {
        if (d.name || d.icdCode) {
          insert.run(
            this.patientId, formatDate(d.date),
            'diagnosis',
            `TanÄ± - ${(d.name || d.icdCode).substring(0, 100)}`,
            `TanÄ±: ${d.name || ''}${d.icdCode ? ' | ICD: ' + d.icdCode : ''}${d.hospital ? ' | Hastane: ' + d.hospital : ''}${d.doctor ? ' | Hekim: ' + d.doctor : ''}${d.type ? ' | TÃ¼r: ' + d.type : ''}`,
            JSON.stringify(d),
            'enabiz'
          );
        }
      }

      console.log(`âœ… ${diagnoses.length} tanÄ± kaydedildi`);
      return diagnoses;
    } catch (e) {
      console.error('âŒ TanÄ± Ã§ekme hatasÄ±:', e.message);
      await this.savePageDebug('error-diagnoses');
      return [];
    }
  }

  // TarayÄ±cÄ±yÄ± kapat
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      console.log('ðŸŒ TarayÄ±cÄ± kapatÄ±ldÄ±');
    }
  }

  // ============ YARDIMCI FONKSÄ°YONLAR ============

  // Tahlil deÄŸerinin normal aralÄ±kta olup olmadÄ±ÄŸÄ±nÄ± kontrol et
  checkAbnormal(value, refRange) {
    if (!refRange || !value) return false;
    const numValue = parseFloat(value.replace(',', '.'));
    if (isNaN(numValue)) return false;

    const match = refRange.match(/([\d.,]+)\s*[-â€“]\s*([\d.,]+)/);
    if (!match) return false;

    const low = parseFloat(match[1].replace(',', '.'));
    const high = parseFloat(match[2].replace(',', '.'));
    return numValue < low || numValue > high;
  }

  // Test adÄ±na gÃ¶re kategori belirle
  categorizeTest(testName) {
    const name = (testName || '').toLowerCase();
    if (name.includes('ca 19-9') || name.includes('cea') || name.includes('afp') || name.includes('tÃ¼mÃ¶r') || name.includes('tumor')) return 'tumor_marker';
    if (name.includes('hemoglobin') || name.includes('lÃ¶kosit') || name.includes('trombosit') || name.includes('wbc') || name.includes('rbc') || name.includes('hematokrit')) return 'hemogram';
    if (name.includes('alt') || name.includes('ast') || name.includes('alp') || name.includes('ggt') || name.includes('bilirubin') || name.includes('karaciÄŸer')) return 'liver';
    if (name.includes('glukoz') || name.includes('hba1c') || name.includes('insÃ¼lin')) return 'glucose';
    if (name.includes('kreatinin') || name.includes('Ã¼re') || name.includes('bÃ¶brek')) return 'kidney';
    if (name.includes('albumin') || name.includes('protein') || name.includes('demir')) return 'nutrition';
    return 'biochemistry';
  }
}

module.exports = ENabizScraper;
