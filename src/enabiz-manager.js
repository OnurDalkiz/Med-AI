const ENabizScraper = require('./enabiz-scraper');
const { KEEP_ALIVE_INTERVAL } = require('./config');
const logger = require('./logger');

const TAG = 'ENABIZ';

// Per-patient state management
const scrapers = new Map();    // patientId -> ENabizScraper
const statuses = new Map();    // patientId -> { state, lastSync, error }
const keepAliveTimers = new Map(); // patientId -> intervalId

function getStatus(patientId) {
  return statuses.get(patientId) || { state: 'idle', lastSync: null, error: null };
}

function setStatus(patientId, updates) {
  const current = getStatus(patientId);
  statuses.set(patientId, { ...current, ...updates });
}

function getScraper(patientId) {
  return scrapers.get(patientId);
}

function isConnected(patientId) {
  const scraper = scrapers.get(patientId);
  return !!scraper && scraper.isLoggedIn;
}

// Keep-alive timer
function startKeepAlive(patientId) {
  stopKeepAlive(patientId);
  const timer = setInterval(async () => {
    const scraper = scrapers.get(patientId);
    if (!scraper || !scraper.isLoggedIn) {
      stopKeepAlive(patientId);
      return;
    }
    const alive = await scraper.keepAlive();
    if (!alive) {
      setStatus(patientId, { state: 'expired', error: 'Oturum düştü' });
      stopKeepAlive(patientId);
    }
  }, KEEP_ALIVE_INTERVAL);
  keepAliveTimers.set(patientId, timer);
  logger.info(TAG, `Keep-alive başlatıldı: Hasta ${patientId} (${KEEP_ALIVE_INTERVAL / 60000} dk aralık)`);
}

function stopKeepAlive(patientId) {
  const timer = keepAliveTimers.get(patientId);
  if (timer) {
    clearInterval(timer);
    keepAliveTimers.delete(patientId);
  }
}

// Scraper lifecycle
async function createScraper(patientId) {
  const existing = scrapers.get(patientId);
  if (existing) await existing.close();

  const scraper = new ENabizScraper(patientId);
  await scraper.launch(false);
  scrapers.set(patientId, scraper);
  return scraper;
}

async function disconnect(patientId) {
  const scraper = scrapers.get(patientId);
  if (scraper) {
    await scraper.close();
    scrapers.delete(patientId);
  }
  stopKeepAlive(patientId);
  const prevStatus = getStatus(patientId);
  setStatus(patientId, { state: 'idle', lastSync: prevStatus.lastSync, error: null });
}

async function manualLogin(patientId) {
  setStatus(patientId, { state: 'logging-in', error: null });
  const scraper = await createScraper(patientId);

  const success = await scraper.manualLogin();
  if (success) {
    setStatus(patientId, { state: 'connected' });
    startKeepAlive(patientId);
  } else {
    setStatus(patientId, { state: 'error', error: 'Giriş zaman aşımı' });
  }
  return success;
}

async function autoLogin(patientId, tc, password) {
  setStatus(patientId, { state: 'logging-in', error: null });
  const scraper = await createScraper(patientId);

  const success = await scraper.login(tc, password);
  if (success) {
    setStatus(patientId, { state: 'connected' });
    startKeepAlive(patientId);
  } else {
    setStatus(patientId, { state: 'error', error: 'Giriş başarısız' });
  }
  return success;
}

async function fetchData(patientId, type = 'all') {
  const scraper = scrapers.get(patientId);
  if (!scraper || !scraper.isLoggedIn) {
    throw new Error('Önce E-Nabız giriş yapın');
  }

  const syncStart = new Date().toISOString();
  setStatus(patientId, { state: 'syncing' });

  let result;
  switch (type) {
    case 'labs': result = await scraper.fetchLabResults(); break;
    case 'prescriptions': result = await scraper.fetchPrescriptions(); break;
    case 'visits': result = await scraper.fetchVisitHistory(); break;
    case 'radiology': result = await scraper.fetchRadiology(); break;
    case 'epicrisis': result = await scraper.fetchEpikriz(); break;
    case 'reports': result = await scraper.fetchReports(); break;
    case 'allergies': result = await scraper.fetchAllergies(); break;
    case 'vaccines': result = await scraper.fetchVaccines(); break;
    case 'chronic': result = await scraper.fetchChronicDiseases(); break;
    case 'surgeries': result = await scraper.fetchSurgeries(); break;
    case 'diagnoses': result = await scraper.fetchDiagnoses(); break;
    default: result = await scraper.fetchAll();
  }

  const lastSync = new Date().toISOString();
  setStatus(patientId, { state: 'connected', lastSync, error: null });

  return { result, syncStart, lastSync };
}

// Get connected patient IDs (for auto-sync)
function getConnectedPatientIds() {
  const ids = [];
  for (const [patientId, scraper] of scrapers.entries()) {
    if (scraper && scraper.isLoggedIn) ids.push(patientId);
  }
  return ids;
}

// Cleanup all (for graceful shutdown)
async function closeAll() {
  for (const [patientId] of scrapers) {
    await disconnect(patientId).catch(() => {});
  }
  logger.info(TAG, 'Tüm E-Nabız bağlantıları kapatıldı');
}

module.exports = {
  getStatus, setStatus, getScraper, isConnected,
  startKeepAlive, stopKeepAlive,
  createScraper, disconnect,
  manualLogin, autoLogin, fetchData,
  getConnectedPatientIds, closeAll
};
