const axios = require('axios');

const PROVIDERS = Object.freeze({
  deepseek: { url: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-flash' },
  openai: { url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', defaultModel: 'gpt-4.1' },
  anthropic: { url: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY', defaultModel: '' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', defaultModel: '' },
  custom: { url: '', env: 'CUSTOM_AI_API_KEY', defaultModel: '' },
});

function providerConfig(provider = 'deepseek', baseUrl) {
  const preset = PROVIDERS[provider];
  if (!preset) throw new Error('Unsupported AI provider');
  let url = preset.url;
  if (provider === 'custom') {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('Enter a custom API base URL');
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('API base URL must be HTTP(S), without credentials, query parameters, or fragments');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) throw new Error('Use HTTPS for remote AI endpoints');
    url = parsed.href.replace(/\/+$/, '');
  }
  return { ...preset, provider, url };
}

function getApiKey(req, provider = 'deepseek') {
  const config = providerConfig(provider, req.body.baseUrl);
  return req.headers['x-api-key'] || process.env[config.env] || '';
}

function createProviderClient(http = axios) {
  function options(config, apiKey) {
    if (!apiKey && config.provider !== 'custom') throw new Error('No API key provided for this provider');
    const headers = { 'Content-Type': 'application/json' };
    if (config.provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return { headers, timeout: 180000, maxRedirects: 0 };
  }

  async function listModels({ provider = 'deepseek', baseUrl, apiKey }) {
    const config = providerConfig(provider, baseUrl);
    const ids = [];
    let after;
    for (let page = 0; page < 10; page++) {
      const url = config.url + '/models' + (after ? '?after_id=' + encodeURIComponent(after) : '');
      const response = await http.get(url, options(config, apiKey));
      if (!Array.isArray(response.data?.data)) throw new Error('Provider returned an invalid model list');
      for (const item of response.data.data) if (typeof item.id === 'string') ids.push(item.id);
      if (provider !== 'anthropic' || !response.data.has_more || !response.data.last_id || response.data.last_id === after) break;
      after = response.data.last_id;
    }
    return [...new Set(ids)].sort();
  }

  async function chat({ provider = 'deepseek', baseUrl, apiKey, model, system, messages, maxTokens = 8192 }) {
    const config = providerConfig(provider, baseUrl);
    model = model || config.defaultModel;
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Choose a valid model ID');
    if (!Array.isArray(messages) || !messages.length || messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
      throw new Error('Chat messages must contain user or assistant text');
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > 65536) throw new Error('Output limit must be between 512 and 65536 tokens');
    const cleanMessages = messages.map(({ role, content }) => ({ role, content }));
    const requestOptions = options(config, apiKey);
    let data, text, finishReason, usage;
    if (provider === 'anthropic') {
      const response = await http.post(config.url + '/messages', {
        model, system, messages: cleanMessages, max_tokens: maxTokens, stream: false,
      }, requestOptions);
      data = response.data;
      text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      finishReason = data.stop_reason;
      usage = data.usage;
    } else {
      const body = { model, messages: [{ role: 'system', content: system }, ...cleanMessages], stream: false };
      body[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
      const response = await http.post(config.url + '/chat/completions', body, requestOptions);
      data = response.data;
      text = data.choices?.[0]?.message?.content;
      finishReason = data.choices?.[0]?.finish_reason;
      usage = data.usage;
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error('Model returned no text. Try a larger output limit or a text chat model.');
    return { message: { role: 'assistant', content: text, provider, model }, usage, finishReason,
      truncated: finishReason === 'length' || finishReason === 'max_tokens' };
  }
  return { listModels, chat };
}

module.exports = { PROVIDERS, providerConfig, getApiKey, createProviderClient };
