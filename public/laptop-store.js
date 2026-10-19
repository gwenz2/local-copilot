(function () {
  const boot=window.__CODEBENCH_LOCAL_STATE__;
  if(!boot || typeof boot.values!=='object')throw new Error('Local laptop storage is unavailable. Start the Draftdrion server and reload.');
  const values={...boot.values},baseline={...boot.values},dirty=new Set();
  let timer,running,failed=false,migration=[];
  const migratedKeys=new Set();
  const known=['aiProvider','aiProfiles','backendUrl','rootDir','contextFiles','chatHistory','histMode','histRange','workbenchLayout','codebenchPreferences'];
  function status(text,error=false) {
    const render=()=>{const label=document.getElementById('localSaveStatus');if(label){label.textContent=text;label.dataset.error=String(error);label.title=error?text:'Preferences, conversations and recovery drafts are stored by the local server.';}};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{once:true});else render();
  }
  async function post(endpoint,body) {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Local save failed');return result;
  }
  // Import legacy browser data once; the laptop file is authoritative afterward.
  if(!Object.keys(values).length) {
    try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(known.includes(key)||key==='dsApiKey'||key?.startsWith('projectSession:'))migratedKeys.add(key);}}catch{}
    for(const key of known){try{const value=localStorage.getItem(key);if(value!==null){values[key]=value;dirty.add(key);}}catch{}}
    let profiles={};try{profiles=JSON.parse(values.aiProfiles||'{}');}catch{}
    try{const old=localStorage.getItem('dsApiKey');if(old&&!profiles.deepseek?.apiKey)profiles.deepseek={...(profiles.deepseek||{}),apiKey:old};}catch{}
    for(const [provider,profile]of Object.entries(profiles))if(profile&&typeof profile==='object'){
      if(profile.apiKey&&provider!=='openui')migration.push({provider,apiKey:profile.apiKey});delete profile.apiKey;
    }
    if(Object.keys(profiles).length){values.aiProfiles=JSON.stringify(profiles);dirty.add('aiProfiles');}
    try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('projectSession:')){values[key]=localStorage.getItem(key);dirty.add(key);}}}catch{}
  }
  const ready=(async()=>{for(const credential of migration)await post('/api/local-credentials',credential);migration=[];})();
  async function flush() {
    clearTimeout(timer);await ready;
    if(running){await running;if(dirty.size&&!failed)return flush();return;}
    if(!dirty.size)return;
    const changes={},expected={};for(const key of dirty){changes[key]=values[key];expected[key]=baseline[key]??null;}
    status('Saving on laptop…');failed=false;
    running=post('/api/local-state',{changes,expected}).then(()=>{
      for(const [key,value]of Object.entries(changes)){baseline[key]=value;if(values[key]===value)dirty.delete(key);}
      status(dirty.size?'Saving on laptop…':'Saved on laptop');
      // Remove only migrated app keys after a confirmed disk save.
      try{for(const key of migratedKeys)localStorage.removeItem(key);migratedKeys.clear();}catch{}
    }).catch(error=>{failed=true;status('Local save failed: '+error.message,true);throw error;}).finally(()=>running=null);
    await running;if(dirty.size&&!failed)return flush();
  }
  window.LaptopStore={ready,getItem:key=>values[key]??null,setItem(key,value){value=String(value);if(values[key]===value)return;values[key]=value;dirty.add(key);clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),250);status('Saving on laptop…');},flush,hasPending:()=>dirty.size>0||Boolean(running),saveCredential:(provider,apiKey)=>post('/api/local-credentials',{provider,apiKey})};
  ready.then(()=>{if(dirty.size)flush().catch(()=>{});else status('Saved on laptop');}).catch(error=>{failed=true;status('Local credential migration failed. Browser data was preserved.',true);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush().catch(()=>{});});
  window.addEventListener('beforeunload',event=>{if(dirty.size||running){event.preventDefault();event.returnValue='';flush().catch(()=>{});}});
})();
