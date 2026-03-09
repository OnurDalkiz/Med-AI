const express = require('express');
const router = express.Router();
const { PROVIDERS, getConfig, saveConfig, validateKey } = require('../ai-engine');
const { asyncHandler } = require('../middleware');

// Mevcut durumu getir (API key maskelenmiş)
router.get('/config', (req, res) => {
  const config = getConfig();
  res.json({
    configured: !!config,
    provider: config?.provider || null,
    model: config?.model || null,
    apiKeyHint: config?.apiKey ? config.apiKey.substring(0, 8) + '...' + config.apiKey.slice(-4) : null
  });
});

// Provider listesi
router.get('/providers', (req, res) => {
  res.json(PROVIDERS);
});

// API key kaydet ve doğrula
router.post('/config', asyncHandler(async (req, res) => {
  const { provider, model, apiKey } = req.body;
  if (!provider || !model || !apiKey) {
    return res.status(400).json({ error: 'provider, model ve apiKey gerekli' });
  }
  if (!PROVIDERS[provider]) {
    return res.status(400).json({ error: 'Geçersiz provider. Desteklenen: openai, anthropic, google' });
  }

  const validation = await validateKey(provider, apiKey, model);
  if (!validation.valid) {
    return res.status(400).json({ error: 'API key geçersiz: ' + validation.error });
  }

  saveConfig({ provider, model, apiKey });
  res.json({ success: true, message: 'AI yapılandırması kaydedildi' });
}));

module.exports = router;
