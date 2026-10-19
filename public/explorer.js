(function(){
  const $=id=>document.getElementById(id);
  let stored={};try{stored=JSON.parse(LaptopStore.getItem('explorerState')||'{}');}catch{}
  let root='',prefs,tree=[],selected='',busy=false,draft,opener,undoEntry,historyGeneration=0;
  const rootKey=value=>value.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
  const matches=(value,parent)=>value.toLowerCase()===parent.toLowerCase()||value.toLowerCase().startsWith(parent.toLowerCase()+'/');
  const remap=(value,from,to)=>matches(value,from)?to+value.slice(from.length):value;
  function sync(){if(root!==state.rootDir){root=state.rootDir;prefs=stored[rootKey(root)]||{expanded:[],selected:'',showHidden:false};selected=prefs.selected||'';undoEntry=null;}prefs||={expanded:[],selected:'',showHidden:false};}
  function persist(){prefs.selected=selected;stored[rootKey(root)]=prefs;LaptopStore.setItem('explorerState',JSON.stringify(stored));}
  function find(nodes,value){for(const node of nodes){if(node.path===value)return node;const child=find(node.children||[],value);if(child)return child;}return null;}
  function parentOf(value){return value.includes('/')?value.slice(0,value.lastIndexOf('/')):'';}
  function select(value,focus=false){selected=value;persist();for(const el of $('fileTree').querySelectorAll('[data-file-path]')){const active=el.dataset.filePath===value;el.classList.toggle('selected',active);el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;if(active&&focus)el.focus();}$('explorerLocation').textContent=value||'Project root';$('explorerLocation').title=value||'Project root';}
  function expandParents(value){let parent=parentOf(value);while(parent){if(!prefs.expanded.includes(parent))prefs.expanded.push(parent);parent=parentOf(parent);}persist();}
  function toggleFolder(value,open){const expanded=new Set(prefs.expanded);if(open??!expanded.has(value))expanded.add(value);else expanded.delete(value);prefs.expanded=[...expanded];persist();render(tree);select(value,true);}
  function rowMenu(value,button,event){select(value);opener=button;const box=button.getBoundingClientRect();openMenu(event?.clientX??box.left,event?.clientY??box.bottom);}
  function render(nodes){
    sync();tree=nodes;const host=$('fileTree');host.replaceChildren();
    if(selected&&!find(nodes,selected))selected='';
    function append(list,parent,depth){for(const node of list){
      const wrap=document.createElement('div'),row=document.createElement('div');row.className='tree-item'+(node.type==='dir'?' dir':'');row.dataset.filePath=node.path;row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+1));row.tabIndex=-1;row.style.paddingLeft=8+depth*10+'px';row.title=node.path;
      const icon=document.createElement('i');icon.className='ti '+(node.type==='dir'?(prefs.expanded.includes(node.path)?'ti-chevron-down':'ti-chevron-right'):getFileIcon(node.name).cls);icon.setAttribute('aria-hidden','true');if(node.type==='file')icon.style.color=getFileIcon(node.name).color;
      const name=document.createElement('span');name.className='tree-item-name';name.textContent=node.name;
      const more=document.createElement('button');more.className='tree-more panel-close';more.innerHTML='<i class="ti ti-dots" aria-hidden="true"></i>';more.setAttribute('aria-label','Actions for '+node.path);more.onclick=event=>{event.stopPropagation();rowMenu(node.path,more);};
      row.appendChild(icon);if(node.type==='dir'){const folder=document.createElement('i');folder.className='ti '+(prefs.expanded.includes(node.path)?'ti-folder-open':'ti-folder');folder.setAttribute('aria-hidden','true');row.appendChild(folder);}row.append(name,more);wrap.appendChild(row);parent.appendChild(wrap);
      row.onclick=()=>{select(node.path);if(node.type==='dir')toggleFolder(node.path);else openFile(node.path);};
      row.oncontextmenu=event=>{event.preventDefault();rowMenu(node.path,row,event);};
      row.onkeydown=event=>{
        if(event.target!==row)return;
        const rows=[...host.querySelectorAll('[role="treeitem"]')].filter(el=>el.getClientRects().length),index=rows.indexOf(row);
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));select(rows[next].dataset.filePath,true);}
        else if(event.key==='Enter'){event.preventDefault();row.click();}
        else if(event.key==='ArrowRight'&&node.type==='dir'){event.preventDefault();if(!prefs.expanded.includes(node.path))toggleFolder(node.path,true);else rows[index+1]?.focus();}
        else if(event.key==='ArrowLeft'){event.preventDefault();if(node.type==='dir'&&prefs.expanded.includes(node.path))toggleFolder(node.path,false);else select(parentOf(node.path),true);}
        else if(event.key==='F2'){event.preventDefault();select(node.path);openAction('rename');}
        else if(event.key==='Delete'){event.preventDefault();select(node.path);openAction('delete');}
        else if(event.key==='F10'&&event.shiftKey){event.preventDefault();rowMenu(node.path,row);}
      };
      if(node.type==='dir'){const children=document.createElement('div');children.setAttribute('role','group');children.hidden=!prefs.expanded.includes(node.path);row.setAttribute('aria-expanded',String(!children.hidden));wrap.appendChild(children);append(node.children||[],children,depth+1);}
    }}
    append(nodes,host,0);if(!nodes.length){const empty=document.createElement('p');empty.className='explorer-empty';empty.textContent=state.rootDir?'This folder has no visible files.':'Open a project folder first.';host.appendChild(empty);}
    host.oncontextmenu=event=>{if(event.defaultPrevented)return;event.preventDefault();select('');opener=host;openMenu(event.clientX,event.clientY);};
    host.onkeydown=event=>{if(event.target!==host||!['ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const rows=[...host.querySelectorAll('[role="treeitem"]')].filter(el=>el.getClientRects().length),row=event.key==='End'?rows.at(-1):rows[0];if(row)select(row.dataset.filePath,true);};
    select(selected);if(!selected&&nodes.length)host.querySelector('[role="treeitem"]').tabIndex=0;
    $('showHiddenFiles').checked=Boolean(prefs.showHidden);refreshHistory();
  }
  function ready(){if(!state.rootDir){Codebench.notify('Open a project folder first.',true);return false;}if(busy||state.loading||Codebench.isApplying()){Codebench.notify('Wait for the current AI request or file action to finish.',true);return false;}return true;}
  function affectedModified(value){return state.openTabs.some(tab=>matches(tab.path,value)&&tab.modified);}
  function openAction(action){
    closeMenu();sync();if(!ready())return;
    const node=find(tree,selected),creating=action.startsWith('create-');if(!creating&&!node){Codebench.notify('Select a file or folder first.');return;}
    if(!creating&&affectedModified(node.path)){Codebench.notify('Save or close unsaved files inside this item before renaming or deleting.',true);return;}
    opener=document.activeElement;const parent=node?.type==='dir'?node.path:parentOf(node?.path||'');
    draft={root:state.rootDir,action,path:node?.path||'',parent};
    $('fileActionTitle').textContent=action==='create-file'?'New file':action==='create-folder'?'New folder':action==='rename'?'Rename or move':'Delete '+node.name+'?';
    $('fileActionField').hidden=action==='delete';$('fileActionName').value=action==='rename'?node.path:'';
    $('fileActionNameLabel').textContent=action==='create-file'?'File name, including extension':action==='create-folder'?'Folder name':'Project-relative path';
    $('fileActionName').placeholder=action==='create-file'?'index.html':action==='create-folder'?'components':'src/index.html';
    $('fileActionHelp').textContent=action==='delete'?'The item and its contents move to local recovery storage. Undo file action restores them.':action==='rename'?'You can change the extension or move into an existing folder. Existing names will not be overwritten.':`Create in ${parent||'project root'}. ${action==='create-file'?'Use the full name, such as index.html, app.js or styles.css.':'The parent folder must already exist.'}`;
    $('fileActionSubmit').textContent=action==='delete'?'Delete':action==='rename'?'Rename / move':'Create';$('fileActionSubmit').classList.toggle('danger',action==='delete');$('fileActionError').textContent='';$('fileActionModal').classList.remove('hidden');
    if(action==='delete')$('fileActionCancel').focus();else{$('fileActionName').focus();$('fileActionName').select();}
  }
  function closeAction(){if(busy)return;$('fileActionModal').classList.add('hidden');opener?.focus();}
  function lock(value){busy=value;for(const el of $('fileActionForm').querySelectorAll('button,input'))el.disabled=value;$('fileActionForm').setAttribute('aria-busy',String(value));if(value)$('fileActionSubmit').textContent='Working…';else if(draft)$('fileActionSubmit').textContent=draft.action==='delete'?'Delete':draft.action==='rename'?'Rename / move':'Create';}
  async function applyChange(result){
    const change=result.change;
    if(change.action==='rename'){
      for(const tab of state.openTabs)if(matches(tab.path,change.from)){tab.path=remap(tab.path,change.from,change.to);if(tab.doc)tab.doc.modeOption=getModeForFile(tab.path);}
      state.activeTab=state.activeTab&&remap(state.activeTab,change.from,change.to);state.contextFiles=state.contextFiles.map(value=>remap(value,change.from,change.to));
      for(const entry of applyHistory)entry.filePath=remap(entry.filePath,change.from,change.to);
      prefs.expanded=prefs.expanded.map(value=>remap(value,change.from,change.to));selected=change.to;
      if(cmEditor&&state.activeTab)cmEditor.setOption('mode',getModeForFile(state.activeTab));
    }else if(['delete','remove'].includes(change.action)){
      state.openTabs=state.openTabs.filter(tab=>!matches(tab.path,change.from));state.contextFiles=state.contextFiles.filter(value=>!matches(value,change.from));prefs.expanded=prefs.expanded.filter(value=>!matches(value,change.from));selected=parentOf(change.from);
      if(!state.openTabs.some(tab=>tab.path===state.activeTab))state.activeTab=state.openTabs[0]?.path||null;
    }else selected=change.from;
    const target=change.to||change.from;expandParents(target);if(target.split('/').some(part=>part.startsWith('.')))prefs.showHidden=true;
    persist();Codebench.resetReview();saveState();renderTabs();renderEditor();renderContextChips();renderContextList();updateUndoBtn();
    $('rootDir').value=state.rootDir;await loadTree();
    if(change.action==='create-file')await openFile(change.from);
    try{await LaptopStore.flush();}catch(error){Codebench.notify('The file action completed, but the editor recovery state could not be saved: '+error.message,true);return;}
    Codebench.notify(result.warning||(result.undo?'File action completed. Undo is available in Explorer.':'File action completed.'));
  }
  async function submit(event){
    event.preventDefault();if(!draft||!ready()||draft.root!==state.rootDir)return;
    const name=$('fileActionName').value.trim();if(draft.action!=='delete'&&!name){$('fileActionError').textContent='Enter a name or path.';return;}
    if(['rename','delete'].includes(draft.action)&&affectedModified(draft.path)){$('fileActionError').textContent='Save or close unsaved files first.';return;}
    const filePath=draft.action.startsWith('create-')?[draft.parent,name].filter(Boolean).join('/'):draft.path;
    lock(true);
    try{const result=await api('/api/explorer/action',{rootDir:draft.root,action:draft.action,filePath,...(draft.action==='rename'?{newPath:name}:{})});await applyChange(result);lock(false);closeAction();}
    catch(error){$('fileActionError').textContent=error.message;await refreshHistory();}
    finally{lock(false);}
  }
  async function refreshHistory(){
    const generation=++historyGeneration,current=state.rootDir;if(!current)return;
    try{const result=await api('/api/explorer/history',{rootDir:current});if(generation!==historyGeneration||current!==state.rootDir)return;
      undoEntry=result.undo;$('undoFileActionBtn').disabled=!undoEntry;$('undoFileActionBtn').title=undoEntry?'Undo '+undoEntry.label:'No file actions to undo';
      const history=$('fileActionHistory');history.replaceChildren();for(const entry of result.entries){const row=document.createElement('p');row.textContent=`${entry.status} · ${entry.label}`;history.appendChild(row);}if(!result.entries.length)history.textContent='No file actions yet.';
    }catch(error){$('fileActionHistory').textContent=error.message;}
  }
  async function undo(){
    closeMenu();if(!ready()||!undoEntry)return;
    // Undo can restore old paths or remove created items; retain all unsaved buffers first.
    if(state.openTabs.some(tab=>tab.modified)){Codebench.notify('Save or close unsaved editor files before Undo file action.',true);return;}
    lock(true);try{const result=await api('/api/explorer/undo',{rootDir:state.rootDir,id:undoEntry.id});await applyChange(result);}catch(error){Codebench.notify(error.message,true);await refreshHistory();}finally{lock(false);}
  }
  function openMenu(x,y){const menu=$('fileContextMenu');menu.hidden=false;for(const button of menu.querySelectorAll('[data-needs-selection]'))button.disabled=!selected;$('fileMenuUndo').disabled=!undoEntry;menu.style.left=Math.max(4,Math.min(x,window.innerWidth-menu.offsetWidth-4))+'px';menu.style.top=Math.max(4,Math.min(y,window.innerHeight-menu.offsetHeight-4))+'px';menu.querySelector('button:not(:disabled)')?.focus();}
  function closeMenu(){ $('fileContextMenu').hidden=true; }
  async function copyPath(){closeMenu();try{await navigator.clipboard.writeText(selected||state.rootDir);Codebench.notify('Path copied.');}catch{Codebench.notify('Clipboard access was unavailable.',true);}}
  window.Explorer={render,openAction,undo,closeAction,copyPath,isBusy:()=>busy,showHidden(target=state.rootDir){sync();return Boolean((rootKey(target)===rootKey(root)?prefs:stored[rootKey(target)])?.showHidden);},async toggleHidden(value){sync();prefs.showHidden=value;persist();await loadTree();},selectRoot(){sync();select('');}};
  $('fileActionForm').addEventListener('submit',submit);
  $('fileActionModal').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeAction();}if(event.key==='Tab'){const controls=[...event.currentTarget.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&event.target===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&event.target===last){event.preventDefault();first.focus();}}});
  document.addEventListener('pointerdown',event=>{if(!$('fileContextMenu').contains(event.target))closeMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('fileContextMenu').hidden){closeMenu();opener?.focus();}if(!$('fileContextMenu').hidden&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=[...$('fileContextMenu').querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}});
  sync();render(explorerTree);
})();
