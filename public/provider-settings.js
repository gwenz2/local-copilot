const providerPresets = {
  deepseek: { label: 'DeepSeek', models: ['deepseek-flash', 'deepseek-v4-pro'], defaultModel: 'deepseek-flash' },
  openai: { label: 'OpenAI', models: ['gpt-4.1', 'gpt-4.1-mini'], defaultModel: 'gpt-4.1' },
  anthropic: { label: 'Claude', models: [], defaultModel: '' },
  gemini: { label: 'Gemini', models: [], defaultModel: '' },
  custom: { label: 'Custom', models: [], defaultModel: '' },
};
let providerDrafts = {};
let providerDraft = 'deepseek';
let modelListRequest = 0;

function readAiProfiles() {
  try { return JSON.parse(localStorage.getItem('aiProfiles') || '{}') || {}; } catch { return {}; }
}
const aiProfiles = readAiProfiles();
state.provider = localStorage.getItem('aiProvider') || 'deepseek';
if (!providerPresets[state.provider]) state.provider = 'deepseek';
if (!aiProfiles.deepseek) aiProfiles.deepseek = { apiKey: state.apiKey, model: 'deepseek-flash' };
Object.assign(state, profileFor(state.provider));

function profileFor(provider) {
  return { apiKey: '', model: providerPresets[provider].defaultModel, baseUrl: '', maxTokens: 8192, ...aiProfiles[provider] };
}

function captureProviderDraft() {
  providerDrafts[providerDraft] = {
    apiKey: document.getElementById('apiKeyInput').value.trim(),
    model: document.getElementById('modelInput').value.trim(),
    baseUrl: document.getElementById('apiBaseUrl').value.trim(),
    maxTokens: Number(document.getElementById('maxTokensInput').value),
  };
}

function selectProviderDraft() {
  captureProviderDraft();
  providerDraft = document.getElementById('providerInput').value;
  renderProviderDraft();
}

function renderProviderDraft() {
  modelListRequest++;
  const profile = providerDrafts[providerDraft] || profileFor(providerDraft);
  document.getElementById('apiKeyInput').value = profile.apiKey;
  document.getElementById('modelInput').value = profile.model;
  document.getElementById('apiBaseUrl').value = profile.baseUrl;
  document.getElementById('maxTokensInput').value = profile.maxTokens;
  document.getElementById('customEndpointField').hidden = providerDraft !== 'custom';
  document.getElementById('deepseekBalanceField').hidden = providerDraft !== 'deepseek';
  document.getElementById('apiKeyLabel').textContent = providerPresets[providerDraft].label + ' API key';
  document.getElementById('modelLoadStatus').textContent = '';
  document.getElementById('loadModelsBtn').disabled = false;
  populateModels(providerPresets[providerDraft].models);
}

function populateModels(models) {
  const list = document.getElementById('modelOptions');
  list.replaceChildren();
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model;
    list.appendChild(option);
  }
}

async function loadProviderModels() {
  captureProviderDraft();
  const provider = providerDraft;
  const profile = providerDrafts[provider];
  const request = ++modelListRequest;
  const status = document.getElementById('modelLoadStatus');
  const button = document.getElementById('loadModelsBtn');
  button.disabled = true;
  status.textContent = 'Loading available models…';
  try {
    const response = await api('/api/models', { provider, baseUrl: profile.baseUrl }, { 'x-api-key': profile.apiKey });
    if (request !== modelListRequest) return;
    populateModels(response.models);
    status.textContent = `${response.models.length} models loaded. Select a text chat model or enter its ID.`;
  } catch (error) {
    if (request === modelListRequest) status.textContent = error.message;
  } finally {
    if (request === modelListRequest) button.disabled = false;
  }
}

function openSettings() {
  providerDrafts = structuredClone(aiProfiles);
  providerDrafts[state.provider] = { apiKey: state.apiKey, model: state.model, baseUrl: state.baseUrl, maxTokens: state.maxTokens };
  providerDraft = state.provider;
  document.getElementById('providerInput').value = providerDraft;
  document.getElementById('backendUrl').value = state.backendUrl;
  renderProviderDraft();
  document.getElementById('settingsModal').classList.remove('hidden');
  document.getElementById('providerInput').focus();
}

function closeSettings() {
  modelListRequest++;
  document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
  captureProviderDraft();
  const profile = providerDrafts[providerDraft];
  if (!profile.model || !Number.isInteger(profile.maxTokens) || profile.maxTokens < 512 || profile.maxTokens > 65536) {
    document.getElementById('modelLoadStatus').textContent = 'Enter a model ID and an output limit from 512 to 65536.';
    return;
  }
  if (providerDraft === 'custom') {
    try {
      const url = new URL(profile.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      document.getElementById('modelLoadStatus').textContent = 'Enter a valid API base URL, such as https://example.com/v1.';
      return;
    }
  }
  Object.assign(aiProfiles, providerDrafts);
  state.provider = providerDraft;
  Object.assign(state, profile);
  state.backendUrl = document.getElementById('backendUrl').value.trim() || window.location.origin;
  localStorage.setItem('aiProfiles', JSON.stringify(aiProfiles));
  localStorage.setItem('aiProvider', state.provider);
  localStorage.setItem('backendUrl', state.backendUrl);
  // Preserve compatibility with the existing DeepSeek-only settings.
  localStorage.setItem('dsApiKey', aiProfiles.deepseek?.apiKey || '');
  closeSettings();
  updateAiStatus();
}

async function checkBalance() {
  const result = document.getElementById('balanceResult');
  result.textContent = 'Checking…';
  try {
    const data = await api('/api/balance', {}, { 'x-api-key': document.getElementById('apiKeyInput').value.trim() });
    result.textContent = data.is_available ? data.balance_infos.map(b => `${b.currency}: ${b.total_balance}`).join(' · ') : 'Account unavailable';
  } catch (error) { result.textContent = error.message; }
}

function updateAiStatus() {
  const label = document.getElementById('aiModelLabel');
  label.textContent = providerPresets[state.provider].label + ' / ' + (state.model || 'Choose model');
  const busy = state.loading;
  document.getElementById('aiRunStatus').textContent = busy ? 'AI working…' : 'Ready';
  document.getElementById('toggleChatBtn').classList.toggle('ai-busy', busy);
}
updateAiStatus();

api('/api/providers').then(result => { state.serverKeys = result.serverKeys; }).catch(() => {});

document.getElementById('settingsModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
  if (event.key === 'Tab') {
    const elements = [...event.currentTarget.querySelectorAll('input,select,button')].filter(element => !element.disabled && element.offsetParent !== null);
    const first=elements[0], last=elements[elements.length-1];
    if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
  }
});
