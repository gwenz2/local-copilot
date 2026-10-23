const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SIMPLE_KEYS = new Set(['aiProvider','aiProfiles','backendUrl','rootDir','contextFiles','chatHistory','histMode','histRange','workbenchLayout','codebenchPreferences','editorDrafts','undoHistory','explorerState','activityHistory']);
function allowedKey(key) { return SIMPLE_KEYS.has(key) || (typeof key === 'string' && key.startsWith('projectSession:') && key.length < 1000); }
function createLocalState(directory = process.env.CODEBENCH_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'),'GwensCodebench')) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'state.json'),credentialFile=path.join(directory,'credentials.json');
  function load(target,fallback) {
    if(!fs.existsSync(target))return fallback;
    try {const value=JSON.parse(fs.readFileSync(target,'utf8'));if(!value || typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
    catch {throw new Error('Local Draftdrion data could not be read. Preserve the file and repair it before continuing.');}
  }
  let values=load(file,{}),credentials=load(credentialFile,{});
  function atomicWrite(target,data) {
    const text=JSON.stringify(data);
    if(Buffer.byteLength(text)>128*1024*1024)throw new Error('Local storage limit reached. Export or clear old conversations before saving more.');
    const temporary=target+'.tmp';fs.writeFileSync(temporary,text,{encoding:'utf8',mode:0o600});fs.renameSync(temporary,target);
  }
  function patch(changes,expected={}) {
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length>1000)throw new Error('Invalid local settings update');
    if(!expected||typeof expected!=='object'||Array.isArray(expected))throw new Error('Invalid local settings baseline');
    const current=load(file,{});
    for(const [key,value] of Object.entries(changes)) {
      if(!allowedKey(key)||typeof value!=='string'||Buffer.byteLength(value)>50*1024*1024)throw new Error('Invalid local settings entry');
      if(['aiProfiles','contextFiles','chatHistory','workbenchLayout','codebenchPreferences','editorDrafts','undoHistory','explorerState','activityHistory'].includes(key)||key.startsWith('projectSession:')){
        const parsed=JSON.parse(value),array=['contextFiles','chatHistory'].includes(key);
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)!==array)throw new Error('Invalid local settings data');
      }
      if((current[key]??null)!==(expected[key]??null)){const error=new Error('Settings changed in another window. Reload before saving again.');error.status=409;throw error;}
      if(key==='aiProfiles') {
        const profiles=JSON.parse(value);
        if(!profiles||typeof profiles!=='object'||Object.values(profiles).some(profile=>!profile||typeof profile!=='object'||Boolean(profile.apiKey)))throw new Error('API credentials must be stored separately on the server');
      }
    }
    const next={...current,...changes};atomicWrite(file,next);values=next;return {saved:true};
  }
  function saveCredential(provider,apiKey) {
    if(!['deepseek','openai','anthropic','gemini','custom'].includes(provider)||typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>4096||/[\r\n\0]/.test(apiKey))throw new Error('Invalid provider credential');
    const next={...load(credentialFile,{}),[provider]:apiKey.trim()};atomicWrite(credentialFile,next);credentials=next;
  }
  const auditFile=path.join(directory,'obsidian-changes.json');
  function memoryChanges(){return (load(auditFile,{changes:[]}).changes||[]).slice(-100);}
  function recordMemoryChange(change){atomicWrite(auditFile,{changes:[...memoryChanges(),change].slice(-100)});}
  return {snapshot:()=>({...load(file,{})}),patch,saveCredential,credentials:()=>({...load(credentialFile,{})}),directory,memoryChanges,recordMemoryChange};
}
module.exports={createLocalState,allowedKey};
