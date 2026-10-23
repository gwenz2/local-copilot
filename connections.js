const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

const ENV_KEYS = ['THESYS_API_KEY','OBSIDIAN_MCP_URL','OBSIDIAN_MCP_AUTHORIZATION','OBSIDIAN_PROJECTS'];
function createConnections(directory, initialEnv = process.env) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file = path.join(directory,'connections.json');
  // Import once; an installed edition must never replace settings saved by the web edition.
  if (!fs.existsSync(file)) {
    try {fs.writeFileSync(file,JSON.stringify(Object.fromEntries(ENV_KEYS.map(key=>[key,initialEnv[key] || '']))),{flag:'wx',mode:0o600});}
    catch(error) {if(error.code!=='EEXIST')throw error;}
  }
  function load() {
    try {
      const value=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!ENV_KEYS.includes(key)) || ENV_KEYS.some(key=>typeof value[key]!=='string'))throw new Error();
      return value;
    } catch {throw new Error('Shared connections could not be read. Preserve connections.json and repair it before continuing.');}
  }
  function revision(value) {return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
  function status() {
    const value=load();
    let projects={};
    try{projects=JSON.parse(value.OBSIDIAN_PROJECTS || '{}');}catch{}
    return {revision:revision(value),openuiConfigured:Boolean(value.THESYS_API_KEY),obsidianConfigured:Boolean(value.OBSIDIAN_MCP_URL&&value.OBSIDIAN_MCP_AUTHORIZATION),obsidianUrl:value.OBSIDIAN_MCP_URL,obsidianAuthorizationConfigured:Boolean(value.OBSIDIAN_MCP_AUTHORIZATION),projects};
  }
  function save(input) {
    const value=load();
    if(!input || typeof input!=='object' || input.revision!==revision(value)) {const error=new Error('Connections changed in another window. Reload Settings before saving.');error.status=409;throw error;}
    const next={...value};
    for(const [field,key] of [['openuiKey','THESYS_API_KEY'],['obsidianAuthorization','OBSIDIAN_MCP_AUTHORIZATION']]) {
      if(input[field]!==undefined) {
        if(typeof input[field]!=='string'||input[field].length>4096||/[\r\n\0]/.test(input[field]))throw new Error('Invalid connection credential');
        if(input[field].trim())next[key]=input[field].trim();
      }
    }
    if(input.removeOpenuiKey===true)next.THESYS_API_KEY='';
    if(input.removeObsidianAuthorization===true)next.OBSIDIAN_MCP_AUTHORIZATION='';
    if(typeof input.obsidianUrl!=='string'||input.obsidianUrl.length>2048)throw new Error('Enter a local Obsidian MCP address');
    const address=input.obsidianUrl.trim();
    if(address) {
      let url;try{url=new URL(address);}catch{throw new Error('Enter a valid local Obsidian MCP address');}
      if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw new Error('Obsidian MCP must use a local HTTP(S) address without embedded credentials');
    }
    next.OBSIDIAN_MCP_URL=address;
    if(!input.projects||typeof input.projects!=='object'||Array.isArray(input.projects)||Object.keys(input.projects).length>100)throw new Error('Invalid Obsidian project mappings');
    const seen=new Set();
    for(const [root,folder] of Object.entries(input.projects)) {
      const normalized=process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root);
      if(!path.isAbsolute(root)||root.length>1000||/[\0\r\n]/.test(root)||seen.has(normalized)||typeof folder!=='string'||!/^02 - Projects\/Active\/[^/\\:.%\x00-\x1f]+$/.test(folder))throw new Error('Map each absolute project folder to one 02 - Projects/Active/<project> vault folder');
      seen.add(normalized);
    }
    next.OBSIDIAN_PROJECTS=JSON.stringify(input.projects);
    const temporary=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,JSON.stringify(next),{mode:0o600});fs.renameSync(temporary,file);}
    finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
    return status();
  }
  function addProject(root, folder) {
    const value = load();
    const projects = JSON.parse(value.OBSIDIAN_PROJECTS || '{}');
    projects[root] = folder;
    return save({ revision: revision(value), obsidianUrl: value.OBSIDIAN_MCP_URL, projects });
  }
  return {env:load,status,save,addProject};
}
module.exports={createConnections};
