(function () {
  function proposals(messages, parse = JSON.parse) {
    const files = new Map();
    for (const message of messages) {
      if (message.role !== 'assistant' || message.error || message.incomplete) continue;
      for (const match of String(message.content || '').matchAll(/^```apply[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?=\r?$)/gm)) {
        try {
          const data = parse(match[1]);
          if (!data || typeof data.filePath !== 'string' || typeof data.content !== 'string' || !data.filePath || /[\\:\x00-\x1f]/.test(data.filePath) || data.filePath.split('/').some(part => !part || part === '.' || part === '..')) continue;
          if (data.action && !['write','create'].includes(data.action)) continue;
          files.set(data.filePath,{...data,action:data.action || 'write'});
        } catch {}
      }
    }
    return [...files.values()];
  }
  function activitySnapshot(history) {
    const projects={};
    for(const [root,runs] of Object.entries(history?.projects || {})) {
      if(!Array.isArray(runs))continue;
      projects[root]=runs.slice(-20).map(item=>({id:item.id,prompt:item.prompt,provider:item.provider,started:item.started,finished:item.finished || null,status:item.finished?item.status:'Interrupted; the app reloaded.',events:(item.events || []).slice(-100).map(event=>({id:event.id,type:event.type,time:event.time,text:event.text,approvalId:event.approvalId,approved:event.approved}))}));
    }
    return {projects};
  }
  function screenshotArtifactPath(value) {
    return typeof value==='string' && /^\/api\/agent\/browser-artifact\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)?value:'';
  }
  if (typeof module !== 'undefined') module.exports = {proposals,activitySnapshot,screenshotArtifactPath};
  if (typeof document === 'undefined') return;

  let saved = {};
  try { saved = JSON.parse(LaptopStore.getItem('codebenchPreferences') || '{}') || {}; } catch {}
  const prefs = {diffLayout:'inline',sound:'all',volume:20,muted:false,reducedMotion:false,focus:false,autoFollow:true,...saved};
  let view = 'code', run, lastPrompt = '', review, reviewGeneration = 0, audio;
  const snapshots = new Map();
  const $ = id => document.getElementById(id);
  let activityHistory;
  try { activityHistory=activitySnapshot(JSON.parse(LaptopStore.getItem('activityHistory') || '{}')); } catch { activityHistory={projects:{}}; }
  let activityRoot='',activityDirty=true;
  const expandedRuns=new Set(),expandedEvents=new Set();
  const activityKey=()=>String(state.rootDir || '(no project)').replace(/\\/g,'/').toLowerCase();
  function saveActivity() { LaptopStore.setItem('activityHistory',JSON.stringify(activitySnapshot(activityHistory))); }
  function syncActivityProject() {
    const root=activityKey();
    if(activityRoot===root)return;
    activityRoot=root;run=null;activityDirty=true;renderActivity();
  }
  const persist = () => { LaptopStore.setItem('codebenchPreferences',JSON.stringify(prefs)); applyPreferences(); };
  function applyPreferences() {
    document.documentElement.dataset.reducedMotion = String(prefs.reducedMotion);
    $('diffLayout').value = prefs.diffLayout;
    ChatScroll.setEnabled(prefs.autoFollow !== false);
    const muted = prefs.muted || prefs.sound === 'off';
    $('soundToggleBtn').setAttribute('aria-pressed',String(muted));
    $('soundToggleBtn').setAttribute('aria-label',muted ? 'Unmute feedback sounds' : 'Mute feedback sounds');
    $('soundToggleBtn').title = muted ? 'Unmute feedback sounds' : 'Mute feedback sounds';
    $('soundToggleBtn').innerHTML = `<i class="ti ${muted ? 'ti-volume-off' : 'ti-volume'}" aria-hidden="true"></i>`;
  }
  function notify(message, error = false) {
    const el = $('workbenchNotice'); el.textContent = message; el.hidden = false; el.dataset.error = String(error);
    clearTimeout(notify.timer); notify.timer = setTimeout(()=>el.hidden=true,6500);
  }
  function showView(next) {
    view = next;
    document.querySelector('.editor-pane').dataset.view = next;
    $('reviewView').hidden = next !== 'review'; $('activityView').hidden = next !== 'activity';
    for (const name of ['code','review','activity']) $('view'+name[0].toUpperCase()+name.slice(1)+'Btn').setAttribute('aria-selected',String(name===next));
    if (next === 'code') requestAnimationFrame(()=>cmEditor?.refresh());
    if (next === 'activity') renderActivity();
  }
  function settingsTab(name = 'ai') {
    document.querySelector('.settings-content').scrollTop=0;
    for (const panel of document.querySelectorAll('[data-settings-panel]')) panel.hidden = panel.dataset.settingsPanel !== name;
    for (const button of document.querySelectorAll('[data-settings-tab]')) button.setAttribute('aria-current',String(button.dataset.settingsTab === name));
  }
  function loadSettings() {
    const layout = getWorkbenchPreferences();
    $('sidebarWidthInput').value = layout.sidebarWidth; $('chatWidthInput').value = layout.chatWidth;
    $('editorFontInput').value = layout.fontSize; $('editorWrapInput').checked = layout.wrap;
    $('defaultDiffInput').value = prefs.diffLayout; $('soundModeInput').value = prefs.sound;
    $('autoFollowInput').checked = prefs.autoFollow !== false;
    $('soundVolumeInput').value = prefs.volume; $('reducedMotionInput').checked = prefs.reducedMotion;
  }
  function savePreferences() {
    const sidebarWidth=Number($('sidebarWidthInput').value),chatWidth=Number($('chatWidthInput').value),fontSize=Number($('editorFontInput').value);
    if (![sidebarWidth,chatWidth,fontSize].every(Number.isFinite) || sidebarWidth<160 || sidebarWidth>600 || chatWidth<220 || chatWidth>1000 || fontSize<10 || fontSize>24) { settingsTab('editor'); notify('Check the panel widths and editor font size.',true); return false; }
    setWorkbenchPreferences({sidebarWidth,chatWidth,fontSize,wrap:$('editorWrapInput').checked});
    prefs.diffLayout = $('defaultDiffInput').value === 'split' ? 'split' : 'inline';
    prefs.sound = $('soundModeInput').value; prefs.volume = Number($('soundVolumeInput').value);
    prefs.reducedMotion = $('reducedMotionInput').checked;
    prefs.autoFollow = $('autoFollowInput').checked;
    persist(); if (review) renderReview(); return true;
  }
  async function initAudio() {
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); } catch {}
  }
  async function sound(kind, preview = false) {
    const mode = preview ? $('soundModeInput').value : prefs.sound;
    if ((!preview && prefs.muted) || mode === 'off' || (mode === 'error' && kind !== 'error')) return;
    await initAudio(); if (!audio || audio.state !== 'running') return;
    const level = Math.max(0,Math.min(100,preview ? Number($('soundVolumeInput').value) : prefs.volume)) / 100;
    const oscillator = audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
    oscillator.type='sine'; oscillator.frequency.setValueAtTime(kind==='error'?240:640,now);
    oscillator.frequency.linearRampToValueAtTime(kind==='error'?180:800,now+.12);
    gain.gain.setValueAtTime(0,now); gain.gain.linearRampToValueAtTime(.08*level,now+.015); gain.gain.exponentialRampToValueAtTime(.0001,now+.22);
    oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(now);oscillator.stop(now+.24);
  }
  function toggleFocus(force) {
    const app = document.querySelector('.app'); const focused = typeof force === 'boolean' ? force : !app.classList.contains('focus-mode');
    app.classList.toggle('focus-mode',focused); $('focusModeBtn').setAttribute('aria-pressed',String(focused));
    if(prefs.focus!==focused){prefs.focus=focused;persist();}
    window.dispatchEvent(new Event('resize'));
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else notify('Browser fullscreen is unavailable. Use your browser’s fullscreen shortcut.'); }
    catch { notify('Fullscreen was blocked by the browser. Try its fullscreen shortcut.',true); }
  }

  function latestReview() {
    for (let i=state.messages.length-1;i>=0;i--) if(proposals([state.messages[i]],parseApplyJson).length) return i;
    return -1;
  }
  function refreshReviewCount() {
    syncActivityProject();
    const index=latestReview(); const count=index<0?0:proposals([state.messages[index]],parseApplyJson).filter(file=>!state.messages[index].appliedFiles?.includes(file.filePath)).length;
    $('reviewCount').textContent=count; $('railReviewCount').textContent=count; $('railReviewCount').hidden=!count;
    $('projectName').textContent=state.rootDir ? state.rootDir.replace(/\\/g,'/').split('/').filter(Boolean).pop() : 'No project';
  }
  async function openReview(index = latestReview()) {
    showView('review');
    if (review?.root !== state.rootDir || review?.index !== index) {
      reviewGeneration++; const message=state.messages[index];
      review={index,root:state.rootDir,files:message?proposals([message],parseApplyJson):[],selected:new Set(),active:null,busy:false};
    }
    renderFileList();
    if (review.files.length && !review.active) await selectFile(review.files[0].filePath);
    else renderReview();
  }
  function snapshotKey(file) { return `${review.root}\n${review.index}\n${file.filePath}`; }
  async function snapshot(file) {
    const key=snapshotKey(file);
    if (snapshots.has(key)) return snapshots.get(key);
    let before='',missing=false;
    try { before=(await api('/api/files/read',{rootDir:review.root,filePath:file.filePath})).content; }
    catch(error) { if(file.action!=='create')throw error; missing=true; }
    const result={before,missing}; snapshots.set(key,result); return result;
  }
  function applied(file) { return state.messages[review.index]?.appliedFiles?.includes(file.filePath); }
  function renderFileList() {
    const list=$('reviewFiles'); list.replaceChildren();
    for(const file of review.files) {
      const row=document.createElement('div'); row.className='review-file'+(review.active===file.filePath?' active':'');
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=review.selected.has(file.filePath);checkbox.disabled=review.busy||applied(file);checkbox.setAttribute('aria-label','Select '+file.filePath);
      checkbox.onchange=()=>{if(checkbox.checked)review.selected.add(file.filePath);else review.selected.delete(file.filePath);updateApplyButton();};
      const button=document.createElement('button');button.textContent=file.filePath;button.title=file.filePath;button.onclick=()=>selectFile(file.filePath);
      const status=document.createElement('small');status.textContent=applied(file)?'Applied':file.action==='create'?'New':'Edit';
      row.append(checkbox,button,status);list.appendChild(row);
    }
    updateApplyButton();
  }
  function updateApplyButton() { const count=review?.selected.size || 0; $('applySelectedBtn').textContent=`Apply selected${count?' ('+count+')':''}`; $('applySelectedBtn').disabled=!count||review.busy||state.loading; }
  async function selectFile(filePath) {
    const generation=++reviewGeneration; review.active=filePath; const file=review.files.find(file=>file.filePath===filePath);
    $('reviewStatus').textContent='Loading original file…';renderFileList();
    try {
      const base=await snapshot(file);
      if(generation!==reviewGeneration)return;
      if(!applied(file))review.selected.add(filePath);
      renderReview();renderFileList();
    } catch(error) { if(generation===reviewGeneration){$('reviewStatus').textContent='Cannot review this file: '+error.message;$('reviewDiff').textContent='Original file could not be read.';} }
  }
  function renderReview() {
    const host=$('reviewDiff');host.replaceChildren();
    const file=review?.files.find(file=>file.filePath===review.active);
    const base=file&&snapshots.get(snapshotKey(file));
    if(!file||!base) { host.innerHTML='<div class="view-empty">Select a proposed file to review its changes.</div>';return; }
    const modified=state.openTabs.find(tab=>tab.path===file.filePath)?.modified;
    $('reviewStatus').textContent=modified?'Save or close your unsaved edits before applying this file.':applied(file)?'Applied. Undo last apply is saved on this laptop.':'Reviewing '+file.filePath+' · files remain unchanged until Apply.';
    const lines=computeDiff(base.before,file.content);
    const makeEditor=(title,value)=>{
      const panel=document.createElement('div');panel.className='diff-editor';const label=document.createElement('div');label.className='diff-editor-label';label.textContent=title;panel.appendChild(label);host.appendChild(panel);
      if(typeof CodeMirror==='undefined') {const pre=document.createElement('pre');pre.textContent=value;panel.appendChild(pre);return null;}
      return CodeMirror(panel,{value,mode:getModeForFile(file.filePath),theme:'dracula',readOnly:true,lineNumbers:true,lineWrapping:getWorkbenchPreferences().wrap,viewportMargin:20});
    };
    host.className='review-diff '+(prefs.diffLayout==='split'?'split-diff':'inline-diff');
    if(prefs.diffLayout==='split') {
      const before=makeEditor('Original',base.before),after=makeEditor('Proposed',file.content);
      for(const line of lines) {if(line.type==='del')before?.addLineClass(line.oldLine-1,'background','diff-removed');if(line.type==='add')after?.addLineClass(line.newLine-1,'background','diff-added');}
      let syncing=false;
      if(before&&after)for(const [a,b]of[[before,after],[after,before]])a.on('scroll',()=>{if(syncing)return;syncing=true;b.scrollTo(a.getScrollInfo().left,a.getScrollInfo().top);syncing=false;});
    } else {
      const editor=makeEditor('Original → proposed · − removed, + added',lines.map(line=>(line.type==='add'?'+ ':line.type==='del'?'− ':'  ')+line.text).join('\n'));
      lines.forEach((line,index)=>{if(line.type!=='ctx')editor?.addLineClass(index,'background',line.type==='add'?'diff-added':'diff-removed');});
    }
    requestAnimationFrame(()=>host.querySelectorAll('.CodeMirror').forEach(el=>el.CodeMirror.refresh()));
  }
  async function applySelected() {
    if(!review||review.busy||state.loading||review.root!==state.rootDir)return;
    review.busy=true;renderFileList();let count=0;
    try {
      for(const file of review.files.filter(file=>review.selected.has(file.filePath))) {
        if(state.openTabs.find(tab=>tab.path===file.filePath)?.modified)throw new Error('Save or close unsaved edits in '+file.filePath+' first.');
        const base=await snapshot(file);
        const button=document.createElement('button');button.dataset.json=encodeURIComponent(JSON.stringify(file));
        const ok=await applyCode(button,base);if(!ok)break;
        const message=state.messages[review.index];message.appliedFiles=[...new Set([...(message.appliedFiles||[]),file.filePath])];
        review.selected.delete(file.filePath);count++;saveState();
      }
      if(count)notify(`Applied ${count} file${count===1?'':'s'}. Undo is available.`);
    } catch(error){notify(error.message,true);}
    finally {review.busy=false;renderFileList();renderReview();refreshReviewCount();}
  }
  function afterUndo(entry) {
    for(const message of state.messages)if(message.appliedFiles&&proposals([message],parseApplyJson).some(file=>file.filePath===entry.filePath&&file.content===entry.after))message.appliedFiles=message.appliedFiles.filter(path=>path!==entry.filePath);
    saveState();refreshReviewCount();if(review){renderFileList();renderReview();}
  }
  function resetReview() {reviewGeneration++;review=null;snapshots.clear();showView('code');refreshReviewCount();}

  function addActivity(event) {
    const text=String(event.text || event.name || event.type).slice(0,1000);
    if(event.type==='status' && run.events.at(-1)?.text===text)return;
    run.events.push({id:crypto.randomUUID(),type:event.type,time:new Date().toISOString(),text,
      output:event.output===undefined?undefined:(typeof event.output==='string'?event.output:JSON.stringify(event.output)).slice(0,20000),
      screenshotUrl:screenshotArtifactPath(event.screenshotUrl),duration:event.duration,
      approvalId:event.id,command:event.command,cwd:event.cwd,reason:event.reason,critical:Boolean(event.critical),approved:event.approved});
    run.events=run.events.slice(-100);activityDirty=true;saveActivity();
  }
  function progress(event) {
    if(!run || run.finished || run.controller.signal.aborted)return;
    if(event.type==='memory-change'){
      run.noteOperations=true;
      run.status=`Obsidian ${event.change.status} · ${event.change.path}`;
      addActivity({type:event.type,text:run.status});
      if(event.change.status!=='requested'){state.messages.push({role:'assistant',content:run.status,memory:{status:'connected',sources:[],changes:[event.change]}});saveState();renderMessages();}
    }
    if(event.type==='delta') {run.raw+=event.text;run.status='Receiving response · '+run.raw.length.toLocaleString()+' characters';}
    else if(event.type==='reset'){run.raw='';}
    else if(event.type==='status') {run.status=event.text;addActivity(event);}
    else if(event.type==='approval') {
      run.status=event.critical?'Critical command needs your approval':'Command needs your approval';
      addActivity({...event,text:run.status});expandedRuns.add(run.id);showView('activity');
    } else if(event.type==='approval-result') {
      const pending=run.events.find(item=>item.approvalId===event.id && item.type==='approval');
      if(pending)pending.approved=event.approved;
      run.status=event.text || (event.approved?'Command approved':'Command denied');addActivity({...event,text:run.status});
    } else if(event.type.startsWith('tool-')) {
      run.status=event.text || `${event.name || 'Tool'} · ${event.type.replace('tool-','')}`;addActivity({...event,text:run.status});
    }
    if(!run.pending){const current=run;current.pending=true;requestAnimationFrame(()=>{current.pending=false;renderActivity();});}
  }
  async function approveCommand(event,approved,host,current) {
    if(!current || current.finished || current!==run || current.controller.signal.aborted)return;
    host.querySelectorAll('button').forEach(button=>button.disabled=true);
    try {
      await api('/api/agent/approval',{id:event.approvalId,approved});
      event.approved=approved;activityDirty=true;saveActivity();renderActivity();
    } catch(error) {if(current===run && !current.finished && !current.controller.signal.aborted){notify(error.message,true);host.querySelectorAll('button').forEach(button=>button.disabled=false);}}
  }
  function renderActivity() {
    const runs=activityHistory.projects[activityKey()] || [],latest=run || runs.at(-1);
    for(const id of ['activityStatus','mainRunState','chatRunState'])$(id).textContent=latest?.status || 'Send a message to begin.';
    if(activityDirty){
      const list=$('activityEvents');list.replaceChildren();
      for(const current of [...runs].reverse()) {
        const row=document.createElement('li'),group=document.createElement('details'),summary=document.createElement('summary');
        row.className='activity-run';group.open=expandedRuns.has(current.id);group.ontoggle=()=>{if(group.open)expandedRuns.add(current.id);else expandedRuns.delete(current.id);};
        const started=document.createElement('time');started.dateTime=current.started;started.textContent=new Date(current.started).toLocaleString();
        const title=document.createElement('span');title.textContent=current.prompt || 'AI request';
        const status=document.createElement('span');status.className='activity-run-status';status.textContent=current.status;
        summary.append(started,title,status);group.appendChild(summary);
        const events=document.createElement('ol');events.className='activity-steps';
        for(const event of current.events){
          const li=document.createElement('li'),time=document.createElement('time'),body=document.createElement('div');
          time.dateTime=event.time;time.textContent=new Date(event.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
          const label=document.createElement('span');label.textContent=event.text+(Number.isFinite(event.duration)?' · '+(event.duration/1000).toFixed(1)+'s':'');body.appendChild(label);
          if(event.output){const details=document.createElement('details'),heading=document.createElement('summary'),output=document.createElement('pre');heading.textContent='View output';output.textContent=event.output;details.open=expandedEvents.has(event.id);details.ontoggle=()=>{if(details.open)expandedEvents.add(event.id);else expandedEvents.delete(event.id);};details.append(heading,output);body.appendChild(details);}
          const screenshot=screenshotArtifactPath(event.screenshotUrl);
          if(screenshot){const details=document.createElement('details'),heading=document.createElement('summary'),image=document.createElement('img');heading.textContent='Browser screenshot';image.src=screenshot;image.alt='Screenshot captured by isolated browser inspection';image.loading='lazy';image.style.maxWidth='100%';details.append(heading,image);body.appendChild(details);}
          if(event.type==='approval') {
            if(event.command){const command=document.createElement('pre');command.textContent=event.command;body.appendChild(command);}
            if(event.cwd || event.reason){const description=document.createElement('p');description.textContent=[event.cwd,event.reason].filter(Boolean).join(' · ');body.appendChild(description);}
            const pending=current===run && !current.finished && !current.controller.signal.aborted && event.approved===undefined;
            if(pending){const actions=document.createElement('div');actions.className='activity-approval';for(const [approved,text]of [[true,event.critical?'Approve critical command once':'Approve once'],[false,'Deny']]){const button=document.createElement('button');button.className='btn-sm';button.textContent=text;button.onclick=()=>approveCommand(event,approved,actions,current);actions.appendChild(button);}body.appendChild(actions);}
            else {const outcome=document.createElement('p');outcome.textContent=event.approved===undefined?'Approval expired':event.approved?'Approved':'Denied';body.appendChild(outcome);}
          }
          li.append(time,body);events.appendChild(li);
        }
        group.appendChild(events);row.appendChild(group);list.appendChild(row);
      }
      activityDirty=false;
    }
    const text=run?.raw.slice(-20000) || '';$('liveResponse').hidden=!text || run?.provider==='openui';$('liveResponse').textContent=text;
    const typing=document.querySelector('.typing-msg .msg-body');
    if(typing && run){let live=typing.querySelector('.live-chat-preview');if(!live){live=document.createElement('pre');live.className='live-chat-preview';typing.appendChild(live);}live.textContent=run.provider==='openui'?'Generating the response…':text;}
  }
  function startRun(prompt,config) {
    syncActivityProject();lastPrompt=prompt;
    run={id:crypto.randomUUID(),prompt:prompt.slice(0,160),started:new Date().toISOString(),raw:'',events:[],provider:config.provider,status:'Preparing context',controller:new AbortController(),noteOperations:false};
    const runs=activityHistory.projects[activityRoot] ||= [];runs.push(run);activityHistory.projects[activityRoot]=runs.slice(-20);expandedRuns.add(run.id);activityDirty=true;initAudio();
    document.querySelector('.app').classList.add('ai-running');$('chatProcess').hidden=false;$('retryBtn').hidden=true;
    document.querySelectorAll('.stop-run').forEach(button=>button.hidden=false);updateApplyButton();progress({type:'status',text:'Preparing attached context'});return run.controller.signal;
  }
  function finishRun(error,stopped=false) {
    if(run && !run.finished){run.status=(error||stopped)&&run.noteOperations?'Check Recent note changes before retrying; a note operation may have completed.':stopped?'Stopped. Incomplete edits cannot be applied.':error?'Request failed. You can retry.':'Response complete';addActivity({type:'status',text:run.status});}
    if(run){run.finished=new Date().toISOString();activityDirty=true;saveActivity();renderActivity();}
    document.querySelector('.app').classList.remove('ai-running');$('chatProcess').hidden=true;$('retryBtn').hidden=!error&&!stopped;
    document.querySelectorAll('.stop-run').forEach(button=>button.hidden=true);refreshReviewCount();updateApplyButton();if(!stopped)sound(error?'error':'complete');
  }
  function retry() {if(state.loading||!lastPrompt)return;resetReview();const last=state.messages.findLastIndex(message=>message.role==='user');if(last>=0){const changes=state.messages.slice(last+1).filter(message=>message.memory?.changes?.length);state.messages.splice(last);state.messages.push(...changes);saveState();renderMessages();}$('chatInput').value=lastPrompt;sendMessage();}
  window.Codebench={showView,settingsTab,loadSettings,savePreferences,notify,progress,startRun,finishRun,refreshReviewCount,openReview,applySelected,afterUndo,resetReview,
    isApplying:()=>Boolean(review?.busy),
    async reloadOriginal(){if(!review||review.busy)return;for(const file of review.files)snapshots.delete(snapshotKey(file));if(review.active)await selectFile(review.active);},
    setDiffLayout(value){prefs.diffLayout=value==='split'?'split':'inline';persist();if(review)renderReview();},
    toggleFocus,toggleFullscreen,stopRun(){if(run && !run.finished && !run.controller.signal.aborted){progress({type:'status',text:'Stopping request…'});run.controller.abort();activityDirty=true;renderActivity();}},retry,
    toggleMute(){prefs.muted=!prefs.muted;persist();},previewSound(){sound('error',true);},
    resetLayoutDraft(){$('sidebarWidthInput').value=240;$('chatWidthInput').value=380;},
  };
  document.addEventListener('fullscreenchange',()=>{$('fullscreenBtn').setAttribute('aria-pressed',String(Boolean(document.fullscreenElement)));window.dispatchEvent(new Event('resize'));});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();toggleFocus();}if(event.key==='Escape'){document.querySelectorAll('.command-menu[open]').forEach(el=>el.open=false);if($('settingsModal').classList.contains('hidden'))toggleFocus(false);}});
  document.addEventListener('click',event=>{const menu=$('commandMenu');if(!menu.contains(event.target)||event.target.closest('.menu-items button'))menu.open=false;});
  applyPreferences();refreshReviewCount();showView('code');toggleFocus(prefs.focus);
})();
