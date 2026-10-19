const providerPresets = {
  deepseek: { label: 'DeepSeek', models: ['deepseek-flash', 'deepseek-v4-pro'], defaultModel: 'deepseek-flash' },
  openai: { label: 'OpenAI', models: ['gpt-4.1', 'gpt-4.1-mini'], defaultModel: 'gpt-4.1' },
  anthropic: { label: 'Claude', models: [], defaultModel: '' },
  gemini: { label: 'Gemini', models: [], defaultModel: '' },
  openui: { label: 'OpenUI Gateway', models: ['google/gemini-3.6-flash-free', 'google/gemini-3.5-flash-free', 'google/gemini-3.1-pro-free', 'google/gemini-3.1-flash-lite-free'], defaultModel: 'google/gemini-3.6-flash-free' },
  custom: { label: 'Custom', models: [], defaultModel: '' },
};
let providerDrafts = {};
let providerDraft = 'deepseek';
let modelListRequest = 0;
let settingsOpener;

function readAiProfiles() {
  try { return JSON.parse(LaptopStore.getItem('aiProfiles') || '{}') || {}; } catch { return {}; }
}
const aiProfiles = readAiProfiles();
state.provider = LaptopStore.getItem('aiProvider') || 'openui';
if (!providerPresets[state.provider]) state.provider = 'openui';
if (!aiProfiles.deepseek) aiProfiles.deepseek = { apiKey: state.apiKey, model: 'deepseek-flash' };
Object.assign(state, profileFor(state.provider));

function profileFor(provider) {
  const profile={ apiKey: '', model: providerPresets[provider].defaultModel, baseUrl: '', maxTokens: 8192, ...aiProfiles[provider] };
  profile.obsidianMode=obsidianModeFor(profile,provider);delete profile.useObsidian;return profile;
}
function obsidianModeFor(profile,provider){return ['off','read-only','read-write'].includes(profile.obsidianMode)?profile.obsidianMode:(profile.useObsidian??provider==='openui')?'read-only':'off';}

function captureProviderDraft() {
  providerDrafts[providerDraft] = {
    apiKey: providerDraft === 'openui' ? '' : document.getElementById('apiKeyInput').value.trim(),
    model: document.getElementById('modelInput').value.trim(),
    baseUrl: document.getElementById('apiBaseUrl').value.trim(),
    maxTokens: Number(document.getElementById('maxTokensInput').value),
    obsidianMode:document.getElementById('obsidianModeInput').value,
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
  document.getElementById('apiKeyInput').value = providerDraft === 'openui' ? '' : profile.apiKey;
  document.getElementById('modelInput').value = profile.model;
  document.getElementById('apiBaseUrl').value = profile.baseUrl;
  document.getElementById('maxTokensInput').value = profile.maxTokens;
  document.getElementById('customEndpointField').hidden = providerDraft !== 'custom';
  document.getElementById('deepseekBalanceField').hidden = providerDraft !== 'deepseek';
  document.getElementById('obsidianMemoryField').hidden = false;
  document.getElementById('obsidianModeInput').value = obsidianModeFor(profile,providerDraft);
  updateObsidianModeHelp();
  document.getElementById('obsidianStatus').textContent = state.obsidianConfigured ? 'Server connection configured. Only permitted notes are accessible.' : 'Configure Obsidian MCP on the local server, then restart.';
  document.getElementById('apiKeyLabel').textContent = providerPresets[providerDraft].label + ' API key';
  document.getElementById('providerHelp').textContent = providerDraft === 'openui'
    ? 'Chat through OpenUI Gateway. The free-model list is ready to use; no custom URL is needed.'
    : providerDraft === 'custom' ? 'Connect an OpenAI-compatible service using its API base URL.' : 'Uses this provider’s API. Model availability and billing depend on your account.';
  updateCredentialStatus();
  document.getElementById('modelLoadStatus').textContent = '';
  document.getElementById('loadModelsBtn').disabled = false;
  populateModels(providerPresets[providerDraft].models);
  updateModelCost();
}

function updateCredentialStatus() {
  const managed = providerDraft === 'openui';
  const configured = state.serverKeys?.[providerDraft];
  const input = document.getElementById('apiKeyInput');
  input.disabled = managed;
  input.placeholder = managed ? 'Managed by the local server' : configured ? 'Leave blank to use the server key' : 'Provider API key';
  const status = document.getElementById('credentialStatus');
  status.textContent = managed
    ? configured ? 'Server key configured. Your key stays off the browser.' : 'Add THESYS_API_KEY to the local .env file, then restart Draftdrion.'
    : configured ? 'A server key is available. Leave this field blank to use it.' : 'A key entered here is saved on this laptop by the local server.';
  status.dataset.tone = managed ? configured ? 'success' : 'warning' : '';
}

function populateModels(models) {
  const list = document.getElementById('modelSelect');
  const current = document.getElementById('modelInput').value.trim();
  list.replaceChildren();
  if (current && !models.includes(current)) list.add(new Option(current, current));
  for (const model of models) {
    list.add(new Option(model + (providerDraft === 'openui' && model.endsWith('-free') ? ' · Free' : ''), model));
  }
  list.add(new Option('Enter a custom model ID…', ''));
  list.value = current;
}

function selectModel() {
  const value = document.getElementById('modelSelect').value;
  if (value) document.getElementById('modelInput').value = value;
  else {
    document.getElementById('settingsAdvanced').open = true;
    document.getElementById('modelInput').focus();
    document.getElementById('modelInput').select();
  }
  updateModelCost();
}

function syncModelSelection() {
  document.getElementById('modelSelect').value = document.getElementById('modelInput').value.trim();
  updateModelCost();
}

function updateModelCost() {
  const help = document.getElementById('modelCostHelp');
  const paid = providerDraft === 'openui' && !document.getElementById('modelInput').value.trim().endsWith('-free');
  help.textContent = providerDraft !== 'openui' ? '' : paid
    ? 'This model is not marked free. Model-token charges may apply.'
    : 'Promotional free models have usage limits. Requests, including attached code, may be used for training.';
  help.dataset.tone = paid ? 'warning' : '';
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
    // shortcut: seed promotional models until Gateway includes them in /models.
    const usePresets = provider === 'openui' && response.models.length === 0;
    const models = usePresets ? providerPresets.openui.models : response.models;
    populateModels(models);
    status.textContent = usePresets
      ? 'Gateway did not list promotional models. Showing the four built-in free choices.'
      : `${models.length} ${provider === 'openui' ? 'free ' : ''}models loaded. Choose a model above.`;
  } catch (error) {
    if (request === modelListRequest) status.textContent = error.message;
  } finally {
    if (request === modelListRequest) button.disabled = false;
  }
}

function openSettings(category = 'workspace') {
  settingsOpener = document.activeElement;
  providerDrafts = structuredClone(aiProfiles);
  providerDrafts[state.provider] = { apiKey: state.apiKey, model: state.model, baseUrl: state.baseUrl, maxTokens: state.maxTokens, obsidianMode:state.obsidianMode };
  providerDraft = state.provider;
  document.getElementById('providerInput').value = providerDraft;
  document.getElementById('backendUrl').value = state.backendUrl;
  renderProviderDraft();
  Codebench.loadSettings();
  Codebench.settingsTab(category);
  document.getElementById('settingsModal').classList.remove('hidden');
  refreshServerKeys();
  loadObsidianChanges();
  document.querySelector(`[data-settings-tab="${category}"]`)?.focus();
}

function closeSettings() {
  modelListRequest++;
  document.getElementById('settingsModal').classList.add('hidden');
  settingsOpener?.focus();
}

async function saveSettings() {
  captureProviderDraft();
  const profile = providerDrafts[providerDraft];
  if (!profile.model || !Number.isInteger(profile.maxTokens) || profile.maxTokens < 512 || profile.maxTokens > 65536) {
    document.getElementById('modelLoadStatus').textContent = 'Enter a model ID and an output limit from 512 to 65536.';
    Codebench.settingsTab('ai');
    return;
  }
  if (providerDraft === 'custom') {
    try {
      const url = new URL(profile.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      document.getElementById('modelLoadStatus').textContent = 'Enter a valid API base URL, such as https://example.com/v1.';
      Codebench.settingsTab('ai');
      return;
    }
  }
  if (!Codebench.savePreferences()) return;
  try {
    for (const [provider,draft] of Object.entries(providerDrafts)) {
      if (draft.apiKey && provider !== 'openui') await LaptopStore.saveCredential(provider,draft.apiKey);
      draft.apiKey='';
    }
  } catch { Codebench.notify('The provider credential could not be saved on this laptop.',true);return; }
  Object.assign(aiProfiles, providerDrafts);
  state.provider = providerDraft;
  Object.assign(state, profile);
  state.backendUrl = document.getElementById('backendUrl').value.trim() || window.location.origin;
  LaptopStore.setItem('aiProfiles', JSON.stringify(aiProfiles));
  LaptopStore.setItem('aiProvider', state.provider);
  LaptopStore.setItem('backendUrl', state.backendUrl);
  try { await LaptopStore.flush(); } catch(error) {Codebench.notify(error.message,true);return;}
  closeSettings();
  updateAiStatus();
  refreshServerKeys();
}

function quickSelectProvider(provider) {
  if (!providerPresets[provider] || state.loading) return;
  state.provider=provider;Object.assign(state,profileFor(provider));
  LaptopStore.setItem('aiProvider',provider);updateAiStatus();
  if (!state.model) openSettings('ai');
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
  document.getElementById('quickProviderInput').value=state.provider;
  document.getElementById('quickProviderInput').disabled=busy;
  document.getElementById('composerModel').textContent=state.model || 'Choose a model';
  document.getElementById('composerModel').title=providerPresets[state.provider].label+' / '+state.model;
  document.getElementById('memoryIndicator').textContent=state.obsidianMode==='read-write'?'Memory · read & write':state.obsidianMode==='read-only'?'Memory · read only':'Memory off';
  document.getElementById('chatContextStatus').textContent=state.contextFiles.length+' attached';
}
updateAiStatus();

function refreshServerKeys() {
  return api('/api/providers').then(result => {
    state.serverKeys = result.serverKeys;
    state.obsidianConfigured = result.obsidianConfigured;
    if (!document.getElementById('settingsModal').classList.contains('hidden')) updateCredentialStatus();
  }).catch(() => {});
}
refreshServerKeys();

async function testObsidianConnection() {
  const button = document.getElementById('testObsidianBtn');
  const status = document.getElementById('obsidianStatus');
  button.disabled = true;
  status.textContent = 'Connecting to Obsidian MCP…';
  try {
    const result = await api('/api/obsidian/status',{provider:providerDraft,obsidianMode:document.getElementById('obsidianModeInput').value,rootDir:state.rootDir});
    status.textContent = result.mode==='off'?'Obsidian access is off.':result.project ? `Connected · ${result.mode==='read-write'?'read & write':'read only'}. Project notes: ${result.project}.` : 'Connected · no project mapping. Shared notes are read only; no writes are available.';
  } catch (error) { status.textContent = error.message; }
  finally { updateObsidianModeHelp(); }
}
function updateObsidianModeHelp(){
  const mode=document.getElementById('obsidianModeInput').value;
  document.getElementById('testObsidianBtn').disabled=mode==='off';
  document.getElementById('obsidianModeHelp').textContent=mode==='off'?'No new Obsidian connection or note retrieval. Earlier chat excerpts remain in conversation history.':mode==='read-only'?'Search and read permitted notes. Notes cannot be changed. Excerpts go to this provider’s selected model.':'Allow project note creation and section updates when requested. Shared instructions/preferences stay read only. No delete or rename tools. Excerpts go to this provider’s selected model.';
}
async function loadObsidianChanges(){
  const list=document.getElementById('obsidianChanges');list.textContent='Loading local change history…';
  try{const result=await api('/api/obsidian/changes',{});list.replaceChildren();
    const entries=[...new Map(result.changes.map(change=>[change.id,change])).values()].slice(-15).reverse();
    if(!entries.length)list.textContent='No note writes recorded.';
    for(const entry of entries){const row=document.createElement('p');row.textContent=`${entry.status} · ${entry.operation} · ${entry.provider} · ${entry.path}`;list.appendChild(row);}
  }catch(error){list.textContent=error.message;}
}

document.getElementById('settingsModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
  if (event.key === 'Tab') {
    const elements = [...event.currentTarget.querySelectorAll('input,select,button,summary')].filter(element => !element.disabled && element.getClientRects().length);
    const first=elements[0], last=elements[elements.length-1];
    if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
  }
});
