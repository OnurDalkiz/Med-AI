const db = require('./database');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'ai-config.json');

// Desteklenen modeller (Mart 2026 güncel)
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.4', label: '⭐ GPT-5.4 (En Güçlü)', description: 'OpenAI\'nın en yeni ve en güçlü modeli. Profesyonel düzey işler için.' },
      { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro (Premium)', description: 'GPT-5.4\'ten daha akıllı ve hassas cevaplar. Derin analiz için.' },
      { id: 'gpt-5', label: 'GPT-5 (Reasoning)', description: 'Reasoning destekli, kodlama ve agentic görevler için. Ayarlanabilir reasoning effort.' },
      { id: 'gpt-5-mini', label: 'GPT-5 Mini (Önerilen)', description: 'GPT-5\'in hızlı ve ekonomik versiyonu. Fiyat/performans şampiyonu.' },
      { id: 'gpt-5-nano', label: 'GPT-5 Nano (En Ucuz)', description: 'En hızlı ve en ucuz GPT-5. Yüksek hacimli işler için.' },
      { id: 'gpt-4.1', label: 'GPT-4.1', description: 'En akıllı non-reasoning model. Güçlü coding. $2/1M input' },
      { id: 'o3', label: 'o3 (Eski Reasoning)', description: 'Eski reasoning modeli, GPT-5 ile yerini bıraktı. $10/1M input' },
      { id: 'o4-mini', label: 'o4-mini (Eski)', description: 'Eski hızlı reasoning modeli. $1.10/1M input' }
    ],
    keyPlaceholder: 'sk-...',
    keyPattern: /^sk-/,
    docsUrl: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    models: [
      { id: 'claude-opus-4-6', label: '⭐ Claude Opus 4.6 (En Güçlü)', description: 'En zeki Claude. Ajan ve kodlama için en iyi. Extended+Adaptive thinking. $5/1M input' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Önerilen)', description: 'Hız ve zeka dengesi mükemmel. Extended+Adaptive thinking. $3/1M input' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Hızlı)', description: 'En hızlı Claude, sınıra yakın zeka. Extended thinking. $1/1M input' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (Eski)', description: 'Önceki en güçlü Claude. $15/1M input' },
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Eski)', description: 'Önceki Sonnet. $3/1M input' }
    ],
    keyPlaceholder: 'sk-ant-...',
    keyPattern: /^sk-ant-/,
    docsUrl: 'https://console.anthropic.com/settings/keys'
  },
  google: {
    name: 'Google (Gemini)',
    models: [
      { id: 'gemini-3.1-pro-preview', label: '⭐ Gemini 3.1 Pro (En Güçlü)', description: 'İleri zeka, karmaşık problem çözme, agentic+vibe coding. Preview' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Önerilen)', description: 'Frontier performans, büyük modellere rakip, çok düşük maliyet. Preview' },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite', description: 'Frontier performans, en düşük maliyet. Preview' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'En gelişmiş stabil model, derin reasoning ve kodlama. Thinking destekli.' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fiyat/performans şampiyonu, thinking destekli, düşük gecikme.' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (En Ucuz)', description: '2.5 ailesinin en hızlı ve en ekonomik modeli.' }
    ],
    keyPlaceholder: 'AIza...',
    keyPattern: /^AIza/,
    docsUrl: 'https://aistudio.google.com/apikey'
  }
};

// Ayarları yükle/kaydet
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) { /* corrupt file */ }
  return null;
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getConfig() {
  // Önce kayıtlı config'e bak, sonra .env'ye bak
  const saved = loadConfig();
  if (saved && saved.apiKey) return saved;

  // .env'den fallback
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your-openai-api-key-here') {
    return { provider: 'openai', model: 'gpt-4o', apiKey: process.env.OPENAI_API_KEY };
  }
  return null;
}

// Provider-specific API çağrıları
async function callOpenAI(config, messages) {
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: config.apiKey });
  // o-series ve gpt-5 serisi reasoning modelleri
  const isOSeries = config.model.startsWith('o');
  const isGPT5Reasoning = config.model.startsWith('gpt-5') && !config.model.includes('chat');

  const params = { model: config.model, messages };

  if (isOSeries) {
    // o3, o4-mini: developer role + max_completion_tokens
    params.max_completion_tokens = 4000;
    params.messages = messages.map(m =>
      m.role === 'system' ? { role: 'developer', content: m.content } : m
    );
  } else if (isGPT5Reasoning) {
    // GPT-5 serisi: reasoning effort destekli
    params.max_completion_tokens = 8000;
    params.temperature = 0.3;
  } else {
    params.temperature = 0.3;
    params.max_tokens = 2000;
  }

  const response = await client.chat.completions.create(params);
  return response.choices[0].message.content;
}

async function callAnthropic(config, messages) {
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMessages = messages.filter(m => m.role !== 'system');

  const isThinking = config.model.includes('opus-4') || config.model.includes('sonnet-4') || config.model.includes('haiku-4') || config.model.includes('3-7');

  const body = {
    model: config.model,
    max_tokens: isThinking ? 16000 : 4000,
    system: systemMsg,
    messages: chatMessages
  };

  if (isThinking) {
    // Extended thinking desteği
    body.thinking = { type: 'enabled', budget_tokens: 10000 };
  } else {
    body.temperature = 0.3;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  // thinking modellerde content array'inde thinking + text blokları olur
  const textBlock = data.content.find(b => b.type === 'text');
  return textBlock?.text || data.content[0].text;
}

async function callGoogle(config, messages) {
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMessages = messages.filter(m => m.role !== 'system');
  const isThinking = config.model.includes('2.5') || config.model.startsWith('gemini-3');

  // Gemini format
  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = {
    system_instruction: { parts: [{ text: systemMsg }] },
    contents,
    generationConfig: { maxOutputTokens: 4000 }
  };

  if (isThinking) {
    // Gemini 2.5 thinking modeli
    body.generationConfig.thinkingConfig = { thinkingBudget: 8000 };
  } else {
    body.generationConfig.temperature = 0.3;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  // Thinking modellerde birden fazla part olabilir, text olanı bul
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought) || parts[parts.length - 1];
  return textPart.text;
}

async function callLLM(messages) {
  const config = getConfig();
  if (!config) throw new Error('AI_NOT_CONFIGURED');

  switch (config.provider) {
    case 'openai': return await callOpenAI(config, messages);
    case 'anthropic': return await callAnthropic(config, messages);
    case 'google': return await callGoogle(config, messages);
    default: throw new Error('Desteklenmeyen provider: ' + config.provider);
  }
}

// API key doğrulama
async function validateKey(provider, apiKey, model) {
  try {
    const testMessages = [
      { role: 'system', content: 'Respond with exactly: OK' },
      { role: 'user', content: 'Test' }
    ];
    const config = { provider, apiKey, model };

    switch (provider) {
      case 'openai': await callOpenAI(config, testMessages); break;
      case 'anthropic': await callAnthropic(config, testMessages); break;
      case 'google': await callGoogle(config, testMessages); break;
      default: throw new Error('Geçersiz provider');
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Hasta bağlamını oluştur
function buildPatientContext(patientId) {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) return '';

  const events = db.prepare(
    'SELECT * FROM medical_events WHERE patient_id = ? ORDER BY event_date DESC LIMIT 20'
  ).all(patientId);

  const labs = db.prepare(
    'SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC LIMIT 30'
  ).all(patientId);

  const meds = db.prepare(
    'SELECT * FROM medications WHERE patient_id = ? AND active = 1'
  ).all(patientId);

  let context = `
## Hasta Bilgileri
- Ad: ${patient.name}
- Cinsiyet: ${patient.gender || 'Belirtilmemiş'}
- Teşhis: ${patient.diagnosis || 'Belirtilmemiş'}
- Teşhis Tarihi: ${patient.diagnosis_date || 'Belirtilmemiş'}
- Notlar: ${patient.notes || 'Yok'}
`;

  if (events.length > 0) {
    context += '\n## Son Tıbbi Olaylar\n';
    for (const e of events) {
      context += `- [${e.event_date}] ${e.event_type}: ${e.title} - ${e.description || ''}\n`;
    }
  }

  if (labs.length > 0) {
    context += '\n## Son Tahlil Sonuçları\n';
    for (const l of labs) {
      const flag = l.is_abnormal ? ' ⚠️ ANORMAL' : '';
      context += `- [${l.test_date}] ${l.test_name}: ${l.test_value} ${l.unit || ''} (Ref: ${l.reference_range || 'N/A'})${flag}\n`;
    }
  }

  if (meds.length > 0) {
    context += '\n## Aktif İlaçlar\n';
    for (const m of meds) {
      context += `- ${m.name} ${m.dosage || ''} - ${m.frequency || ''}\n`;
    }
  }

  return context;
}

const SYSTEM_PROMPT_BASE = `Sen deneyimli bir tıp uzmanı asistanısın. Hastanın sağlık verilerini analiz edip takip ediyorsun.

## Görevin
- Hastanın tıbbi verilerini analiz et ve anlaşılır şekilde açıkla
- Tahlil sonuçlarını yorumla (normal/anormal değerleri belirt)
- Tedavi süreci hakkında bilgi ver
- Beslenme ve yaşam tarzı önerileri sun
- Doktor ziyareti öncesi sorulacak soruları hazırla
- Aile üyelerine durumu anlatırken kullanabilecekleri basit açıklamalar yap

## Kurallar
- Sen bir AI asistansın, doktor değilsin. Bunu her kritik öneri öncesinde hatırlat.
- Kesin teşhis koyma, sadece bilgilendirme yap.
- "Doktorunuza danışın" uyarısını gerekli yerlerde ekle.
- Türkçe yanıt ver.
- Hastanın duygusal durumunu da göz önünde bulundur, empatik ol.
- Hastanın tanısına ve durumuna özel bilgiler ver.
- Bilimsel olarak kanıtlanmamış tedavileri açıkça belirt.`;

async function chat(patientId, userMessage) {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  const patientContext = buildPatientContext(patientId);

  // Hasta tanısına özel system prompt oluştur
  let systemPrompt = SYSTEM_PROMPT_BASE;
  if (patient) {
    systemPrompt += `\n\n## Hasta: ${patient.name}\n- Tanı: ${patient.diagnosis || 'Belirtilmemiş'}\n- Notlar: ${patient.notes || 'Yok'}`;
  }

  // Son 20 mesajı al
  const history = db.prepare(
    'SELECT role, content FROM chat_history WHERE patient_id = ? ORDER BY id DESC LIMIT 20'
  ).all(patientId).reverse();

  const messages = [
    { role: 'system', content: systemPrompt + '\n\n' + patientContext },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const assistantMessage = await callLLM(messages);

  // Chat geçmişine kaydet
  const insert = db.prepare(
    'INSERT INTO chat_history (patient_id, role, content) VALUES (?, ?, ?)'
  );
  insert.run(patientId, 'user', userMessage);
  insert.run(patientId, 'assistant', assistantMessage);

  return assistantMessage;
}

// Tahlil sonuçlarını AI ile analiz et
async function analyzeLabResults(patientId, labData) {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  const diagnosisContext = patient?.diagnosis ? `${patient.diagnosis} hastası` : 'hasta';

  const prompt = `Aşağıdaki tahlil sonuçlarını ${diagnosisContext} bağlamında analiz et. 
Her değer için normal/anormal durumu belirt ve klinik önemi açıkla:

${JSON.stringify(labData, null, 2)}

Özellikle dikkat edilmesi gereken değerleri belirt ve klinik önemini açıkla.`;

  return await chat(patientId, prompt);
}

module.exports = { chat, analyzeLabResults, buildPatientContext, PROVIDERS, getConfig, saveConfig, validateKey };
