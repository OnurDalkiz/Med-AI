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

  // Tarayıcıyı başlat (kalıcı profil ile - cookie'ler saklanır)
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

    // Bot algılamayı engellemek için navigator.webdriver'ı gizle
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['tr-TR', 'tr', 'en-US', 'en']
      });
    });

    console.log('🌐 Tarayıcı başlatıldı (anti-detection aktif)');
    return this;
  }

  // E-Nabız'a TC + şifre ile giriş
  async login(tcNo, password) {
    console.log('🔐 E-Nabız giriş yapılıyor...');
    await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    // Cookie popup varsa kapat
    try {
      const cookieBtn = this.page.locator('text=Okay').or(this.page.locator('text=Tamam'));
      if (await cookieBtn.isVisible({ timeout: 2000 })) await cookieBtn.click();
    } catch (e) { /* cookie popup yok */ }

    // Zaten giriş yapılmış mı kontrol et (kalıcı profil sayesinde)
    try {
      await this.page.waitForURL('**/Home/**', { timeout: 5000 });
      console.log('✅ Zaten giriş yapılmış (kayıtlı oturum)');
      this.isLoggedIn = true;
      return true;
    } catch (e) { /* giriş yapılmamış, devam */ }

    // TC ve şifre alanlarını doldur
    const tcInput = this.page.locator('input[name="TCKimlikNo"], input[id*="TCKimlik"], input[placeholder*="T.C."]').first();
    const passInput = this.page.locator('input[type="password"]').first();

    await tcInput.waitFor({ timeout: 10000 });
    await tcInput.fill(tcNo);
    await passInput.fill(password);

    // Giriş butonuna tıkla
    const loginBtn = this.page.locator('button[type="submit"], input[type="submit"], button:has-text("Giriş")').first();
    await loginBtn.click();

    // Captcha veya SMS doğrulama olabilir - kullanıcıya bilgi ver
    console.log('⏳ Giriş bekleniyor (Captcha/SMS doğrulama gerekirse tarayıcıda tamamlayın)...');

    try {
      await this.page.waitForURL('**/Home/**', { timeout: 120000 }); // 2 dakika bekle
      console.log('✅ E-Nabız giriş başarılı!');
      this.isLoggedIn = true;
      return true;
    } catch (e) {
      console.error('❌ Giriş zaman aşımı - Captcha/SMS doğrulamayı tamamlayın');
      return false;
    }
  }

  // Manuel giriş: tarayıcıyı aç, kullanıcı kendisi giriş yapsın
  async manualLogin() {
    console.log('🔐 Tarayıcı açıldı - E-Nabız\'a manuel giriş yapın...');

    // Önce mevcut oturumu kontrol et — login sayfasına hiç gitmeden
    try {
      await this.page.goto(`${ENABIZ_URL}/Home/Index`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const currentUrl = this.page.url();
      if (currentUrl.includes('/Home') && !currentUrl.includes('Login')) {
        console.log('✅ Zaten giriş yapılmış (kayıtlı oturum)');
        this.isLoggedIn = true;
        return true;
      }
    } catch (e) {
      console.log('  ℹ️ Oturum kontrolü atlanıyor:', e.message?.substring(0, 80));
    }

    // Login sayfasına git (retry ile)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        break; // başarılıysa döngüden çık
      } catch (e) {
        console.log(`  ⚠️ Login sayfası yükleme denemesi ${attempt}/3:`, e.message?.substring(0, 80));
        if (attempt < 3) {
          await this.page.waitForTimeout(2000);
        } else {
          // Son denemede hâlâ başarısızsa, Google'a gidip oradan dene
          try {
            await this.page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
            await this.page.waitForTimeout(1000);
            await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (e2) {
            throw new Error('E-Nabız login sayfasına erişilemiyor: ' + e2.message);
          }
        }
      }
    }

    // Zaten giriş yapılmış mı kontrol et (kalıcı profil sayesinde)
    try {
      await this.page.waitForURL('**/Home/**', { timeout: 8000 });
      console.log('✅ Zaten giriş yapılmış (kayıtlı oturum)');
      this.isLoggedIn = true;
      return true;
    } catch (e) { /* giriş yapılmamış, devam */ }

    console.log('⏳ Giriş yapmanızı bekliyorum (10 dakika süreniz var)...');
    console.log('📌 Tarayıcıda E-Nabız\'a giriş yapın, /Home sayfasına yönlendirilene kadar bekliyorum.');
    try {
      await this.page.waitForURL('**/Home/**', { timeout: 600000 }); // 10 dakika
      console.log('✅ Giriş başarılı!');
      this.isLoggedIn = true;
      return true;
    } catch (e) {
      console.error('❌ Giriş zaman aşımı (10 dakika doldu)');
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

  // ============ NAVİGASYON KEŞFİ ============

  // Oturumu canlı tut — E-Nabız session timeout'unu önle
  async keepAlive() {
    if (!this.isLoggedIn || !this.page) return false;
    try {
      // Hafif bir API isteği yap (sayfa değiştirmeden)
      const isAlive = await this.page.evaluate(async () => {
        try {
          const resp = await fetch('/Home/Index', { method: 'HEAD', credentials: 'include' });
          return resp.ok || resp.status === 302;
        } catch (e) { return false; }
      });

      if (isAlive) {
        console.log('💓 E-Nabız oturum keep-alive başarılı');
        return true;
      }

      // HEAD başarısız olduysa, tam sayfa navigasyonu dene
      const resp = await this.page.goto(`${ENABIZ_URL}/Home/Index`, {
        waitUntil: 'domcontentloaded', timeout: 15000
      });
      const url = this.page.url();
      if (url.includes('/Home') && !url.includes('Login')) {
        console.log('💓 E-Nabız oturum keep-alive başarılı (navigasyon)');
        return true;
      }

      // Login sayfasına yönlendirildi — oturum düşmüş
      console.log('⚠️ E-Nabız oturumu düşmüş, yeniden giriş gerekiyor');
      this.isLoggedIn = false;
      return false;
    } catch (e) {
      console.error('❌ Keep-alive hatası:', e.message);
      return false;
    }
  }

  // Ana sayfadan tüm menü linklerini keşfet
  async discoverNavLinks() {
    console.log('🔍 E-Nabız menü yapısı keşfediliyor...');

    try {
      // Ana sayfaya git
      await this.page.goto(`${ENABIZ_URL}/Home/Index`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await this.page.waitForTimeout(3000);

      // Sayfadaki tüm linkleri ve menü öğelerini tara
      const allLinks = await this.page.evaluate(() => {
        const links = [];
        // Tüm <a> etiketlerini tara
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent?.trim() || '';
          if (href && !href.startsWith('#') && !href.startsWith('javascript') && text) {
            links.push({ href, text: text.substring(0, 100) });
          }
        });
        // Menü butonları da olabilir
        document.querySelectorAll('[data-url], [data-href], [onclick]').forEach(el => {
          const url = el.getAttribute('data-url') || el.getAttribute('data-href') || '';
          const text = el.textContent?.trim() || '';
          if (url && text) {
            links.push({ href: url, text: text.substring(0, 100) });
          }
        });
        return links;
      });

      // Kategori eşleştirmesi: Türkçe anahtar kelimelere göre linkleri bul
      const categories = {
        labs: ['tahlil'],
        prescriptions: ['recete', 'reçete'],
        visits: ['ziyaret', 'randevu'],
        radiology: ['radyolojik'],
        allergies: ['alerji'],
        vaccines: ['aşı takvimi', 'asi takvimi', 'asitakvimi'],
        chronic: ['hastalıklarım', 'hastaliklarim'],
        diagnoses: ['hastalıklarım', 'hastaliklarim'],
        surgeries: ['ameliyat'],
        epicrisis: ['epikriz'],
        reports: ['raporlarım', 'raporlarim'],
        pathology: ['patoloji'],
        medications: ['ilaçlarım', 'ilaclarim'],
        screenings: ['tarama'],
        emergencyNotes: ['acil durum not'],
        documents: ['dokümanlarım', 'dokumanlarim']
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
            console.log(`  📌 ${category}: ${this.navLinks[category]} (${link.text})`);
            break;
          }
        }
      }

      // Bulunamayan kategoriler için keşfedilen tüm linkleri logla
      const foundCategories = Object.keys(this.navLinks);
      const missingCategories = Object.keys(categories).filter(c => !foundCategories.includes(c));

      if (missingCategories.length > 0) {
        console.log(`⚠️ Bulunamayan kategoriler: ${missingCategories.join(', ')}`);
        console.log('📋 Sayfadaki tüm linkler:');
        allLinks.forEach(l => console.log(`   ${l.text} → ${l.href}`));
      }

      // Linkleri dosyaya kaydet (debug için)
      const linksPath = path.join(__dirname, '..', 'data', 'enabiz-nav-links.json');
      fs.writeFileSync(linksPath, JSON.stringify({ discovered: this.navLinks, allLinks, timestamp: new Date().toISOString() }, null, 2));

      console.log(`✅ ${foundCategories.length}/${Object.keys(categories).length} kategori keşfedildi`);
      return this.navLinks;
    } catch (e) {
      console.error('❌ Nav keşif hatası:', e.message);
      return {};
    }
  }

  // Menü tıklayarak veya URL ile sayfaya git
  async navigateToSection(category, fallbackKeywords) {
    // 1. Keşfedilmiş link varsa kullan
    if (this.navLinks[category]) {
      console.log(`  🔗 Keşfedilen link kullanılıyor: ${this.navLinks[category]}`);
      const response = await this.page.goto(this.navLinks[category], {
        waitUntil: 'domcontentloaded', timeout: 30000
      });

      // 404 kontrolü
      if (response && response.status() !== 404) {
        await this.page.waitForTimeout(3000);
        return true;
      }
      console.log(`  ⚠️ Keşfedilen link 404 verdi, menü tıklama denenecek...`);
    }

    // 2. Menü elementini tıklamayı dene
    for (const keyword of fallbackKeywords) {
      try {
        // Önce ana sayfaya dön
        await this.page.goto(`${ENABIZ_URL}/Home/Index`, {
          waitUntil: 'domcontentloaded', timeout: 15000
        });
        await this.page.waitForTimeout(2000);

        // Menüdeki linki veya butonu bul
        const menuItem = this.page.locator(`a:has-text("${keyword}"), button:has-text("${keyword}"), [class*="menu"] >> text="${keyword}"`).first();
        if (await menuItem.isVisible({ timeout: 3000 })) {
          console.log(`  🖱️ Menü tıklanıyor: "${keyword}"`);
          await menuItem.click();
          await this.page.waitForTimeout(3000);

          // 404 kontrolü
          const url = this.page.url();
          const content = await this.page.content();
          if (!content.includes('404') && !content.includes("can't be found")) {
            // Başarılı navigasyon - linki kaydet
            this.navLinks[category] = url;
            return true;
          }
        }
      } catch (e) { /* bu keyword ile bulamadık, sonrakini dene */ }
    }

    // 3. Sidebar/hamburger menüyü aç ve tekrar dene
    try {
      const menuToggle = this.page.locator('[class*="hamburger"], [class*="menu-toggle"], .navbar-toggler, [class*="sidebar"] button').first();
      if (await menuToggle.isVisible({ timeout: 2000 })) {
        await menuToggle.click();
        await this.page.waitForTimeout(1000);

        for (const keyword of fallbackKeywords) {
          const sideItem = this.page.locator(`a:has-text("${keyword}"), [class*="nav"] >> text="${keyword}"`).first();
          if (await sideItem.isVisible({ timeout: 2000 })) {
            console.log(`  🖱️ Sidebar menü tıklanıyor: "${keyword}"`);
            await sideItem.click();
            await this.page.waitForTimeout(3000);
            this.navLinks[category] = this.page.url();
            return true;
          }
        }
      }
    } catch (e) { /* sidebar yok */ }

    console.log(`  ❌ "${category}" sayfasına ulaşılamadı`);
    return false;
  }

  // ============ VERİ ÇEKME FONKSİYONLARI ============

  // Sayfa navigasyonu yapıp AJAX verilerin yüklenmesini bekle
  async navigateAndWait(category, fallbackKeywords) {
    const navigated = await this.navigateToSection(category, fallbackKeywords);
    if (!navigated) return false;

    // AJAX verilerinin yüklenmesini bekle (networkidle + extra süre)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (e) { /* timeout olabilir, devam */ }
    await this.page.waitForTimeout(3000);

    return true;
  }

  // Network interceptor: sayfaya giderken yapılan API çağrılarını yakala
  async fetchWithNetworkCapture(url, label) {
    const apiResponses = [];

    // XHR/fetch isteklerini dinle
    const captureHandler = async (response) => {
      try {
        const reqUrl = response.url();
        const status = response.status();
        const contentType = response.headers()['content-type'] || '';

        // JSON API yanıtlarını yakala (sayfa asset'leri hariç)
        if (status === 200 && (contentType.includes('json') || contentType.includes('text/plain'))) {
          // Static dosyaları atla
          if (reqUrl.match(/\.(js|css|png|jpg|svg|woff|ico|map)(\?|$)/i)) return;

          const body = await response.text().catch(() => '');
          if (body && body.length > 2) {
            apiResponses.push({
              url: reqUrl,
              contentType,
              body: body.substring(0, 100000),
              size: body.length
            });
            console.log(`    📡 API yakalandı: ${reqUrl.substring(0, 100)} (${body.length} bytes)`);
          }
        }
      } catch (e) { /* yanıt okunamadı */ }
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

  // Full DOM yapı analizi — sayfadaki tüm anlamlı text node'ları çek
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

      // 1. Tüm tabloları çek (header + body)
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

      // 2. Sayfadaki tüm büyük text bloklarını çek (nav/header hariç)
      const skipTags = new Set(['NAV', 'HEADER', 'FOOTER', 'SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT']);
      const visited = new Set();

      function collectText(el, depth = 0) {
        if (!el || depth > 15) return;
        if (skipTags.has(el.tagName)) return;
        // Nav class'lı elemanları atla
        const cls = (el.className || '').toString().toLowerCase();
        if (cls.includes('nav') || cls.includes('header') || cls.includes('footer') || cls.includes('cookie')) return;

        const text = el.textContent?.trim();
        if (!text || text.length < 3 || visited.has(text)) return;

        // Yaprak düğüm veya anlamlı içerik
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
          // Çocukları tara
          for (const child of el.children) {
            collectText(child, depth + 1);
          }
        }
      }

      // body'nin doğrudan çocuklarından başla
      for (const child of document.body.children) {
        collectText(child);
      }

      // 3. DOM yapı haritası (ilk 3 seviye)
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

  // Tahlil sonuçlarını çek - Network interception + DOM analizi
  async fetchLabResults() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('🔬 Tahlil sonuçları çekiliyor...');

    try {
      const labUrl = this.navLinks.labs || `${ENABIZ_URL}/Home/Tahlillerim`;
      await this.page.goto(labUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniş aralığa ayarla (en eski yıl → 2026)
      try {
        const startYearSelect = this.page.locator('#baslangicyilSelect');
        if (await startYearSelect.isVisible({ timeout: 3000 })) {
          const options = await startYearSelect.locator('option[value]').allTextContents();
          const years = options.map(y => y.trim()).filter(y => /^\d{4}/.test(y));
          if (years.length > 0) {
            const earliest = years[years.length - 1]; // son option genelde en eski yıl
            await startYearSelect.selectOption(earliest);
            console.log(`  📅 Başlangıç yılı: ${earliest}`);
          }
        }
        // Ara butonuna tıkla
        const searchBtn = this.page.locator('.tarihFiltreBtn').first();
        if (await searchBtn.isVisible({ timeout: 2000 })) {
          await searchBtn.click();
          await this.page.waitForTimeout(3000);
        }
      } catch (e) { console.log('  ⚠️ Tarih filtresi ayarlanamadı:', e.message); }

      // E-Nabız'ın tahlil DOM yapısını doğrudan parse et
      console.log('  🔍 E-Nabız tahlil DOM yapısı parse ediliyor...');
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
              testDate = hidden.textContent.trim(); // "09.03.2026" formatı
            } else {
              const gun = dateEl.querySelector('.zCardDateGun')?.textContent?.trim() || '';
              const ay = dateEl.querySelector('.zCardDateAy')?.textContent?.trim() || '';
              const yil = dateEl.querySelector('.zCardDateYil')?.textContent?.trim() || '';
              if (gun && yil) testDate = `${gun}.${ay}.${yil}`;
            }
          }

          // Hastane adı
          const hospital = item.querySelector('.hastaneAdi')?.textContent?.trim() || '';

          // Her tahlil grubu (Hemogram, Biyokimya, vs.)
          const tahlilLists = item.querySelectorAll('.tahlilList');
          for (const tlist of tahlilLists) {
            const groupHeader = tlist.querySelector('.tahlilHeader [islemadi], .tahlilHeader #islemAdi');
            const groupName = groupHeader?.getAttribute('islemadi') || groupHeader?.textContent?.trim() || '';

            // Her test satırı
            const rows = tlist.querySelectorAll('.tahlilBody .rowContaier, .tahlilBody .rowContainer');
            for (const row of rows) {
              const nameEl = row.querySelector('.islemAdiContainer [islemadi], .islemAdiContainer #islemAdi');
              const testName = nameEl?.getAttribute('islemadi') || '';

              // Sonuç, Birim, Referans - columnContainer divlerinden çek
              const cols = row.querySelectorAll('.columnContainer');
              let testValue = '', unit = '', refRange = '';
              for (const col of cols) {
                const text = col.textContent?.trim() || '';
                const label = col.querySelector('span')?.textContent?.trim() || '';
                const value = text.replace(label, '').trim();
                if (label.includes('Sonuç') && !label.includes('Birimi')) testValue = value;
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

      console.log(`  📊 DOM'dan ${labData.length} tahlil sonucu çıkarıldı`);

      // Accordion kapalıysa ve sonuç yoksa, tüm accordionları aç ve tekrar dene
      if (labData.length === 0) {
        console.log('  🔄 Accordion kapalı olabilir, açılıyor...');
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
              if (label.includes('Sonuç') && !label.includes('Birimi')) testValue = value;
              else if (label.includes('Birimi')) unit = value;
              else if (label.includes('Referans')) refRange = value;
            }
            if (testName && testValue) {
              // Üst accordion'dan tarih
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
          console.log(`  📊 Accordion açıldıktan sonra ${retryData.length} sonuç bulundu`);
        }
      }

      // Hala sonuç yoksa dateSelect'ten tarihleri seçmeyi dene
      if (labData.length === 0) {
        console.log('  🔄 Tarih seçici ile yükleme deneniyor...');
        const dateOptions = await this.page.evaluate(() => {
          const sel = document.querySelector('#dateSelect');
          if (!sel) return [];
          return Array.from(sel.options).map(o => o.text?.trim()).filter(t => t && /\d{2}\.\d{2}\.\d{4}/.test(t));
        });
        console.log(`  📅 ${dateOptions.length} tarih mevcut: ${dateOptions.slice(0, 5).join(', ')}...`);

        for (const dateOpt of dateOptions) {
          await this.page.selectOption('#dateSelect', { label: dateOpt });
          await this.page.waitForTimeout(2000);

          // Accordion açıldıktan sonra tekrar parse et
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
                if (label.includes('Sonuç') && !label.includes('Birimi')) testValue = value;
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
            console.log(`    ✅ ${dateOpt}: ${dateData.length} sonuç`);
          }
        }
      }

      await this.savePageDebug('labs');

      // Tarih formatını DD.MM.YYYY → YYYY-MM-DD'ye çevir
      const formatDate = (d) => {
        if (!d) return new Date().toISOString().split('T')[0];
        const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
      };

      // Veritabanına kaydet
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

      console.log(`✅ ${saved} tahlil sonucu kaydedildi (${labData.length} toplam bulundu)`);
      return { count: saved, data: labData };
    } catch (e) {
      console.error('❌ Tahlil çekme hatası:', e.message);
      await this.savePageDebug('error-labs');
      return { count: 0, data: [], error: e.message };
    }
  }

  // API'den gelen JSON objesini normalize et
  normalizeLabItem(item) {
    // E-Nabız API farklı field isimleri kullanabilir - hepsini dene
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

    // Nested yapılar "Sonuclar" arrayı olabilir
    if (!result.testName && item.Sonuclar && Array.isArray(item.Sonuclar)) {
      return item.Sonuclar.map(s => this.normalizeLabItem(s));
    }

    // Obje'yi string olarak da kaydet (hiç field bulunamazsa)
    if (!result.testName && !result.testValue) {
      const keys = Object.keys(item).filter(k => !['__type', 'Id', 'id'].includes(k));
      result.testName = keys.map(k => `${k}: ${item[k]}`).join(', ').substring(0, 200);
      result.testValue = 'raw-data';
    }

    return result;
  }

  // Genel veri çekme (reçete, muayene, radyoloji için ortak)
  async fetchSectionData(category, fallbackKeywords, label) {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log(`📋 ${label} çekiliyor...`);

    try {
      const url = this.navLinks[category] || null;
      let apiResponses = [];

      if (url) {
        apiResponses = await this.fetchWithNetworkCapture(url, category);
      } else {
        const navigated = await this.navigateAndWait(category, fallbackKeywords);
        if (!navigated) {
          console.log(`⚠️ ${label} sayfasına ulaşılamadı`);
          await this.savePageDebug(`${category}-nav-fail`);
          return [];
        }
      }

      // DOM'dan veri çek
      const pageContent = await this.extractFullPageContent();
      await this.savePageDebug(category);

      let results = [];

      // 1. API yanıtlarından
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
            console.log(`  ✅ API'den ${items.length} kayıt: ${resp.url.substring(0, 80)}`);
            for (const item of items) {
              results.push({
                text: JSON.stringify(item).substring(0, 1000),
                date: item.Tarih || item.tarih || item.Date || item.date || item.IslemTarihi || '',
                raw: item
              });
            }
          }
        } catch (e) { /* JSON parse hatası */ }
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

      // 3. Text bloklarından
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

      console.log(`✅ ${results.length} ${label} kaydı bulundu`);
      return results;
    } catch (e) {
      console.error(`❌ ${label} hatası:`, e.message);
      await this.savePageDebug(`error-${category}`);
      return [];
    }
  }

  // Reçeteleri çek — her reçetenin ilaç detaylarını da çek ve DB'ye kaydet
  async fetchPrescriptions() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('💊 Reçeteler çekiliyor (ilaç detayları dahil)...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const url = this.navLinks.prescriptions || `${ENABIZ_URL}/Home/Recetelerim`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniş aralığa ayarla
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

      // DataTable'dan reçeteleri + detay butonundaki parametreleri çek
      const prescriptions = await this.page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('#recetelerTbody tr, #tbl-recetelerim tbody tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            // Detay butonundan parametreleri çıkar
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

      console.log(`  📋 ${prescriptions.length} reçete bulundu, ilaç detayları çekiliyor...`);

      // Her reçetenin ilaç detayını çek (API çağrısı ile)
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
              // HTML'den ilaç tablosunu parse et
              const meds = await this.page.evaluate((html) => {
                const div = document.createElement('div');
                div.innerHTML = html;
                const medications = [];

                // tbl-RecetedeYazanİlaclar tablosu — yazılan ilaçlar
                const rows = div.querySelectorAll('table tbody tr');
                for (const row of rows) {
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 2) {
                    const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
                    // İlaç adı genelde ilk veya ikinci kolonda
                    const drugName = texts.find(t => t.length > 3 && !t.match(/^\d+$/) && !t.match(/^\d{2}\.\d{2}\.\d{4}$/)) || '';
                    if (drugName) {
                      medications.push({
                        name: drugName,
                        allCells: texts
                      });
                    }
                  }
                }

                // Ayrıca tüm text'i de sakla (detaylı analiz için)
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
                console.log(`    💊 Reçete ${rx.prescriptionNo}: ${meds.medications.length} ilaç`);
              }

              // Detay HTML'i debug olarak kaydet (ilk reçete)
              if (allMedications.length <= 5) {
                const debugPath = path.join(__dirname, '..', 'data', `prescription-detail-${rx.prescriptionNo}.html`);
                fs.writeFileSync(debugPath, detailHtml);
              }

              // Reçete event'ini kur — tüm ilaç listesi dahil
              rx.medications = meds.medications;
              rx.detailText = meds.fullText;
            }
          } catch (e) {
            console.log(`    ⚠️ Reçete ${rx.prescriptionNo} detay alınamadı: ${e.message}`);
          }
          await this.page.waitForTimeout(500); // Rate limiting
        }
      }

      await this.savePageDebug('prescriptions');

      // DB — medical_events tablosuna reçete + ilaç detay bilgisi ile kaydet
      const insertEvent = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      // DB — medications tablosuna her ilacı ekle
      const insertMed = db.prepare(
        'INSERT OR IGNORE INTO medications (patient_id, name, dosage, frequency, start_date, prescribed_by, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );

      for (const rx of prescriptions) {
        if (rx.date) {
          const medNames = (rx.medications || []).map(m => m.name).join(', ');
          insertEvent.run(
            this.patientId, formatDate(rx.date),
            'prescription',
            `Reçete ${rx.prescriptionNo} - ${rx.type}`,
            `Hekim: ${rx.doctor} | Reçete No: ${rx.prescriptionNo} | Tür: ${rx.type}${medNames ? ' | İlaçlar: ' + medNames : ''}`,
            JSON.stringify({ medications: rx.medications || [], detailText: rx.detailText || '' }),
            'enabiz'
          );
        }
      }

      // Her ilacı medications tablosuna ekle
      for (const med of allMedications) {
        insertMed.run(
          this.patientId,
          med.name,
          med.allCells?.join(' | ') || '', // dosage - tüm hücreleri birleştir
          '', // frequency
          formatDate(med.date),
          med.doctor,
          `Reçete: ${med.prescriptionNo} | Tür: ${med.type}`,
          1
        );
      }

      console.log(`✅ ${prescriptions.length} reçete + ${allMedications.length} ilaç detayı kaydedildi`);
      return { prescriptions, medications: allMedications };
    } catch (e) {
      console.error('❌ Reçete çekme hatası:', e.message);
      await this.savePageDebug('error-prescriptions');
      return { prescriptions: [], medications: [] };
    }
  }

  // Muayene/Randevu geçmişini çek ve DB'ye kaydet
  async fetchVisitHistory() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('🏥 Muayene/randevu geçmişi çekiliyor...');

    try {
      const url = this.navLinks.visits || `${ENABIZ_URL}/Home/Randevularim`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // DataTable'dan randevuları çek
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
          const dateStr = visit.date.split(' ')[0]; // "2026-03-09 15:10:00" → "2026-03-09"
          insert.run(
            this.patientId, dateStr,
            'appointment',
            `${visit.clinic} - ${visit.hospital}`,
            `Klinik: ${visit.clinic} | Yer: ${visit.location} | Hekim: ${visit.doctor} | Durum: ${visit.status} | Hastane: ${visit.hospital}`,
            'enabiz'
          );
        }
      }

      console.log(`✅ ${visits.length} muayene/randevu kaydedildi`);
      return visits;
    } catch (e) {
      console.error('❌ Muayene çekme hatası:', e.message);
      await this.savePageDebug('error-visits');
      return [];
    }
  }

  // Radyoloji raporlarını çek — rapor metni ve görüntü linkleri dahil
  async fetchRadiology() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('📷 Radyoloji raporları çekiliyor (detaylı)...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const url = this.navLinks.radiology || `${ENABIZ_URL}/Home/RadyolojikGoruntulerim`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniş aralığa ayarla
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

      // Radyoloji kartlarından veri + detay parametrelerini çek
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
            description = description.replace(/^Açıklama\s*:\s*/i, '').trim();
          }

          // showHtmlReport encrypted ID'sini çek
          let encryptedId = '';
          const reportBtn = card.querySelector('a[onclick*="showHtmlReport"], button[onclick*="showHtmlReport"]');
          if (reportBtn) {
            const onclick = reportBtn.getAttribute('onclick') || '';
            const match = onclick.match(/showHtmlReport\('([^']+)'\)/);
            if (match) encryptedId = match[1];
          }

          // openImageLink image ID'sini çek
          let imageId = '';
          const imageBtn = card.querySelector('a[onclick*="openImageLink"], button[onclick*="openImageLink"]');
          if (imageBtn) {
            const onclick = imageBtn.getAttribute('onclick') || '';
            const match = onclick.match(/openImageLink\('([^']+)'\)/);
            if (match) imageId = match[1];
          }

          // Thumbnail/base64 görsel varsa
          const thumbnail = card.querySelector('img[src*="data:image"]')?.getAttribute('src') || '';

          if (date || description) {
            results.push({ date, hospital, description, encryptedId, imageId, hasThumbnail: !!thumbnail, thumbnailData: thumbnail });
          }
        }
        return results;
      });

      console.log(`  📋 ${radiology.length} radyoloji kaydı bulundu, rapor detayları çekiliyor...`);

      // Her kart için rapor metnini çek (showHtmlReport API'si ile)
      for (const rad of radiology) {
        if (rad.encryptedId) {
          try {
            // RadyolojiApp.showHtmlReport çağrısını simulate et
            const reportText = await this.page.evaluate(async (encId) => {
              try {
                // E-Nabız'ın kullandığı API endpoint'ini çağır
                const resp = await fetch('/RadyolojikGoruntu/GetHtmlReport?encryptedId=' + encId, {
                  method: 'GET',
                  credentials: 'include'
                });
                if (resp.ok) {
                  const html = await resp.text();
                  // HTML'den saf metin çıkar
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
              console.log(`    📄 Rapor alındı: ${rad.description.substring(0, 50)}... (${reportText.text.length} karakter)`);

              // İlk rapor HTML'ini debug olarak kaydet
              const debugPath = path.join(__dirname, '..', 'data', `radiology-report-${rad.encryptedId.substring(0, 10)}.html`);
              fs.writeFileSync(debugPath, reportText.html || '');
            }
          } catch (e) {
            console.log(`    ⚠️ Rapor alınamadı: ${e.message}`);
          }
          await this.page.waitForTimeout(500);
        }

        // Alternatif: showHtmlReport'u DOM üzerinden çağır (modal açarak)
        if (!rad.reportText && rad.encryptedId) {
          try {
            await this.page.evaluate((encId) => {
              if (typeof RadyolojiApp !== 'undefined' && RadyolojiApp.showHtmlReport) {
                RadyolojiApp.showHtmlReport(encId);
              }
            }, rad.encryptedId);
            await this.page.waitForTimeout(2000);

            // Modal açıldıysa içeriğini oku
            const modalText = await this.page.evaluate(() => {
              const modal = document.querySelector('#radyolojikGoruntuDetayModal, .modal.show, .modal[style*="display: block"]');
              if (modal) {
                const text = modal.textContent?.replace(/\s+/g, ' ').trim() || '';
                // Modalı kapat
                const closeBtn = modal.querySelector('.btn-close, [data-bs-dismiss="modal"], .close');
                if (closeBtn) closeBtn.click();
                return text.substring(0, 5000);
              }
              return '';
            });

            if (modalText && modalText.length > 50) {
              rad.reportText = modalText;
              console.log(`    📄 Rapor (modal): ${rad.description.substring(0, 50)}... (${modalText.length} karakter)`);
            }
          } catch (e) { /* modal yöntemi başarısız */ }
        }
      }

      await this.savePageDebug('radiology');

      // DB'ye kaydet (medical_events tablosuna) — rapor metni dahil
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const rad of radiology) {
        if (rad.description) {
          insert.run(
            this.patientId, formatDate(rad.date),
            'radiology',
            `Radyoloji - ${rad.description.substring(0, 100)}`,
            `${rad.description} | Hastane: ${rad.hospital}${rad.reportText ? '\n\n--- RAPOR METNİ ---\n' + rad.reportText : ''}`,
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
      console.log(`✅ ${radiology.length} radyoloji raporu kaydedildi (${withReport} adet rapor metni ile)`);
      return radiology;
    } catch (e) {
      console.error('❌ Radyoloji çekme hatası:', e.message);
      await this.savePageDebug('error-radiology');
      return [];
    }
  }

  // Epikriz (Taburculuk/Çıkış Özetleri) çek — kanser tedavi geçmişi için kritik
  async fetchEpikriz() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('📋 Epikriz (taburculuk özetleri) çekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      await this.page.goto(`${ENABIZ_URL}/Home/Epikrizlerim`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniş aralığa ayarla
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

      // Sayfa yapısını keşfet — epikriz listesi genelde DataTable veya card formatında
      const epicrises = await this.page.evaluate(() => {
        const results = [];

        // DataTable formatı
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
            // Satır tıklanabilir mi?
            const rowOnclick = row.getAttribute('onclick') || '';

            results.push({
              cellTexts: texts,
              detailOnclick,
              rowOnclick,
              fullRowText: row.textContent?.trim().substring(0, 500) || ''
            });
          }
        }

        // Card / Accordion formatı
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

        // Tüm sayfayı al (eğer yapı farklıysa)
        const pageText = document.querySelector('.content-area, .main-content, #content, main, [role="main"]')?.textContent?.trim().substring(0, 5000) || '';

        return { items: results, pageText };
      });

      console.log(`  📋 ${epicrises.items.length} epikriz kaydı bulundu`);

      // Her epikriz detayına tıklayıp içeriği çek
      for (let i = 0; i < epicrises.items.length; i++) {
        const ep = epicrises.items[i];
        // Detay linkine tıkla eğer varsa
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
              // Onclick çağır ve modal/panel bekle
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
              console.log(`    📄 Epikriz detayı alındı (${ep.detailContent.length} karakter)`);
            }
          } catch (e) {
            console.log(`    ⚠️ Epikriz detayı alınamadı: ${e.message}`);
          }
        }
      }

      // DB'ye kaydet
      const insert = db.prepare(
        'INSERT OR IGNORE INTO medical_events (patient_id, event_date, event_type, title, description, data, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      let saved = 0;
      for (const ep of epicrises.items) {
        // Tarih çıkarmaya çalış
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

      // Eğer hiç kayıt bulunamadıysa sayfa metnini kaydet (yapı analizi için)
      if (saved === 0 && epicrises.pageText && epicrises.pageText.length > 50) {
        insert.run(
          this.patientId, new Date().toISOString().split('T')[0],
          'epicrisis',
          'Epikriz Sayfası İçeriği',
          epicrises.pageText,
          JSON.stringify({ raw: true }),
          'enabiz'
        );
        saved = 1;
      }

      console.log(`✅ ${saved} epikriz kaydedildi`);
      return epicrises.items;
    } catch (e) {
      console.error('❌ Epikriz çekme hatası:', e.message);
      await this.savePageDebug('error-epikriz');
      return [];
    }
  }

  // Tıbbi Raporlar (Raporlarım sayfası) çek
  async fetchReports() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('📑 Tıbbi raporlar çekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      await this.page.goto(`${ENABIZ_URL}/Home/Raporlarim`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Tarih filtresini en geniş aralığa ayarla
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

      // Sayfa yapısını keşfet
      const reports = await this.page.evaluate(() => {
        const results = [];

        // DataTable formatı
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

        // Card / List formatı
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

      console.log(`  📋 ${reports.items.length} rapor kaydı bulundu`);

      // Her rapor detayına tıklayıp içeriği çek
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
              console.log(`    📄 Rapor detayı alındı (${rp.detailContent.length} karakter)`);
            }
          } catch (e) {
            console.log(`    ⚠️ Rapor detayı alınamadı: ${e.message}`);
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
          'Raporlarım Sayfası İçeriği',
          reports.pageText,
          JSON.stringify({ raw: true }),
          'enabiz'
        );
        saved = 1;
      }

      console.log(`✅ ${saved} rapor kaydedildi`);
      return reports.items;
    } catch (e) {
      console.error('❌ Rapor çekme hatası:', e.message);
      await this.savePageDebug('error-reports');
      return [];
    }
  }

  // Debug: Sayfa yapısını kaydet (screenshot + FULL HTML)
  async savePageDebug(label) {
    try {
      const timestamp = Date.now();
      const ssPath = path.join(__dirname, '..', 'data', `page-${label}-${timestamp}.png`);
      await this.page.screenshot({ path: ssPath, fullPage: true });

      // Tam body HTML kaydet (eski gibi küçük bir selector değil)
      const html = await this.page.evaluate(() => document.body.innerHTML.substring(0, 200000));
      const htmlPath = path.join(__dirname, '..', 'data', `page-${label}-${timestamp}.html`);
      fs.writeFileSync(htmlPath, html);

      console.log(`📸 Debug kaydedildi: ${ssPath}`);
      return { screenshot: ssPath, html: htmlPath };
    } catch (e) {
      console.error('📸 Debug kayıt hatası:', e.message);
      return null;
    }
  }

  // Tüm verileri çek (A'dan Z'ye)
  async fetchAll() {
    console.log('\n🔄 Tüm E-Nabız verileri çekiliyor (detaylı)...\n');

    // Önce navigasyon linklerini keşfet
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
      'E-Nabız Veri Senkronizasyonu (Kapsamlı)',
      `Tahlil: ${results.labs.count || 0}, Reçete: ${rxCount} (${medCount} ilaç), Muayene: ${results.visits.length}, Radyoloji: ${results.radiology.length}, Epikriz: ${results.epicrisis.length}, Rapor: ${results.reports.length}, Alerji: ${results.allergies.length}, Aşı: ${results.vaccines.length}, Kronik: ${results.chronicDiseases.length}, Ameliyat: ${results.surgeries.length}, Tanı: ${results.diagnoses.length}`,
      'system');

    console.log('\n✅ E-Nabız senkronizasyonu tamamlandı (kapsamlı)\n');
    return results;
  }

  // ============ YENİ VERİ ÇEKME FONKSİYONLARI ============

  // Alerji bilgilerini çek
  async fetchAllergies() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('🤧 Alerji bilgileri çekiliyor...');

    try {
      const navigated = await this.navigateToSection('allergies', ['Alerjilerim', 'Alerji', 'Alerjiler']);
      if (!navigated) {
        console.log('⚠️ Alerji sayfasına ulaşılamadı, atlanıyor');
        return [];
      }

      const allergies = await this.page.evaluate(() => {
        const results = [];

        // Tablo formatı
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

        // Card / list formatı
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

        // Sayfa içeriğini al (yapı farklıysa)
        if (results.length === 0) {
          const pageText = document.querySelector('.content-area, .main-content, #content, main, [role="main"]')?.textContent?.trim() || '';
          if (pageText.length > 30) {
            results.push({ allergen: 'Sayfa İçeriği', fullText: pageText.substring(0, 2000) });
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
        if (a.allergen && a.allergen !== 'Sayfa İçeriği') {
          insert.run(
            this.patientId, new Date().toISOString().split('T')[0],
            'allergy',
            `Alerji - ${a.allergen.substring(0, 100)}`,
            `Alerjen: ${a.allergen}${a.type ? ' | Tür: ' + a.type : ''}${a.severity ? ' | Şiddet: ' + a.severity : ''}${a.reaction ? ' | Reaksiyon: ' + a.reaction : ''}`,
            JSON.stringify(a),
            'enabiz'
          );
        }
      }

      console.log(`✅ ${allergies.length} alerji kaydedildi`);
      return allergies;
    } catch (e) {
      console.error('❌ Alerji çekme hatası:', e.message);
      await this.savePageDebug('error-allergies');
      return [];
    }
  }

  // Aşı kayıtlarını çek
  async fetchVaccines() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('💉 Aşı kayıtları çekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const navigated = await this.navigateToSection('vaccines', ['Aşı Takvimi', 'Aşılarım', 'Aşı', 'AsiTakvimi']);
      if (!navigated) {
        console.log('⚠️ Aşı sayfasına ulaşılamadı, atlanıyor');
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
            `Aşı - ${v.name.substring(0, 100)}`,
            `Aşı: ${v.name}${v.dose ? ' | Doz: ' + v.dose : ''}${v.institution ? ' | Kurum: ' + v.institution : ''}`,
            JSON.stringify(v),
            'enabiz'
          );
        }
      }

      console.log(`✅ ${vaccines.length} aşı kaydedildi`);
      return vaccines;
    } catch (e) {
      console.error('❌ Aşı çekme hatası:', e.message);
      await this.savePageDebug('error-vaccines');
      return [];
    }
  }

  // Kronik hastalıkları çek
  async fetchChronicDiseases() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('🩺 Kronik hastalıklar çekiliyor...');

    try {
      const navigated = await this.navigateToSection('chronic', ['Hastalıklarım', 'Kronik', 'Hastalıklarım']);
      if (!navigated) {
        console.log('⚠️ Hastalık sayfasına ulaşılamadı, atlanıyor');
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
            `Kronik Hastalık - ${d.name.substring(0, 100)}`,
            `Hastalık: ${d.name}${d.icdCode ? ' | ICD: ' + d.icdCode : ''}${d.startDate ? ' | Başlangıç: ' + d.startDate : ''}${d.institution ? ' | Kurum: ' + d.institution : ''}`,
            JSON.stringify(d),
            'enabiz'
          );
        }
      }

      console.log(`✅ ${diseases.length} kronik hastalık kaydedildi`);
      return diseases;
    } catch (e) {
      console.error('❌ Kronik hastalık çekme hatası:', e.message);
      await this.savePageDebug('error-chronic');
      return [];
    }
  }

  // Ameliyat kayıtlarını çek
  async fetchSurgeries() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('🔪 Ameliyat kayıtları çekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const navigated = await this.navigateToSection('surgeries', ['Ameliyatlarım', 'Ameliyat', 'Ameliyatlar', 'Cerrahi']);
      if (!navigated) {
        console.log('⚠️ Ameliyat sayfasına ulaşılamadı, atlanıyor');
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

      console.log(`✅ ${surgeries.length} ameliyat kaydedildi`);
      return surgeries;
    } catch (e) {
      console.error('❌ Ameliyat çekme hatası:', e.message);
      await this.savePageDebug('error-surgeries');
      return [];
    }
  }

  // Tanı/ICD kodları çek
  async fetchDiagnoses() {
    if (!this.isLoggedIn) throw new Error('Önce giriş yapın');
    console.log('🔍 Tanı/ICD kayıtları çekiliyor...');

    const formatDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    };

    try {
      const navigated = await this.navigateToSection('diagnoses', ['Hastalıklarım', 'Tanı', 'Hastalıklarım']);
      if (!navigated) {
        console.log('⚠️ Tanı sayfasına ulaşılamadı, atlanıyor');
        return [];
      }

      // Tarih filtresini en geniş aralığa ayarla
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
            `Tanı - ${(d.name || d.icdCode).substring(0, 100)}`,
            `Tanı: ${d.name || ''}${d.icdCode ? ' | ICD: ' + d.icdCode : ''}${d.hospital ? ' | Hastane: ' + d.hospital : ''}${d.doctor ? ' | Hekim: ' + d.doctor : ''}${d.type ? ' | Tür: ' + d.type : ''}`,
            JSON.stringify(d),
            'enabiz'
          );
        }
      }

      console.log(`✅ ${diagnoses.length} tanı kaydedildi`);
      return diagnoses;
    } catch (e) {
      console.error('❌ Tanı çekme hatası:', e.message);
      await this.savePageDebug('error-diagnoses');
      return [];
    }
  }

  // Tarayıcıyı kapat
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      console.log('🌐 Tarayıcı kapatıldı');
    }
  }

  // ============ YARDIMCI FONKSİYONLAR ============

  // Tahlil değerinin normal aralıkta olup olmadığını kontrol et
  checkAbnormal(value, refRange) {
    if (!refRange || !value) return false;
    const numValue = parseFloat(value.replace(',', '.'));
    if (isNaN(numValue)) return false;

    const match = refRange.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
    if (!match) return false;

    const low = parseFloat(match[1].replace(',', '.'));
    const high = parseFloat(match[2].replace(',', '.'));
    return numValue < low || numValue > high;
  }

  // Test adına göre kategori belirle
  categorizeTest(testName) {
    const name = (testName || '').toLowerCase();
    if (name.includes('ca 19-9') || name.includes('cea') || name.includes('afp') || name.includes('tümör') || name.includes('tumor')) return 'tumor_marker';
    if (name.includes('hemoglobin') || name.includes('lökosit') || name.includes('trombosit') || name.includes('wbc') || name.includes('rbc') || name.includes('hematokrit')) return 'hemogram';
    if (name.includes('alt') || name.includes('ast') || name.includes('alp') || name.includes('ggt') || name.includes('bilirubin') || name.includes('karaciğer')) return 'liver';
    if (name.includes('glukoz') || name.includes('hba1c') || name.includes('insülin')) return 'glucose';
    if (name.includes('kreatinin') || name.includes('üre') || name.includes('böbrek')) return 'kidney';
    if (name.includes('albumin') || name.includes('protein') || name.includes('demir')) return 'nutrition';
    return 'biochemistry';
  }
}

module.exports = ENabizScraper;
