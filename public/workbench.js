(function () {
  function panelWidths(total, sidebar, chat, leftVisible, rightVisible) {
    const available = Math.max(0, total - 280 - (leftVisible ? 5 : 0) - (rightVisible ? 5 : 0));
    let left = leftVisible ? Math.min(Math.max(160, sidebar), Math.max(160, available - (rightVisible ? 220 : 0))) : 0;
    let right = rightVisible ? Math.min(Math.max(220, chat), Math.max(220, available - left)) : 0;
    return { left, right };
  }
  if (typeof module !== 'undefined') module.exports = { panelWidths };
  if (typeof document === 'undefined') return;
  let saved = {};
  try { saved = JSON.parse(LaptopStore.getItem('workbenchLayout') || '{}') || {}; } catch {}
  const prefs = { sidebarWidth:240, chatWidth:380, sidebarCollapsed:false, chatCollapsed:false, wrap:false, fontSize:13, ...saved };
  const app = document.querySelector('.app');
  let compactPanel=null;
  const persist = () => LaptopStore.setItem('workbenchLayout', JSON.stringify(prefs));

  function applyLayout() {
    const focus=app.classList.contains('focus-mode');
    const compact=window.innerWidth<720;
    app.classList.toggle('compact-panels',compact);
    const leftVisible = !focus && (compact ? compactPanel==='explorer' : !prefs.sidebarCollapsed);
    const rightVisible = !focus && (compact ? compactPanel==='chat' : !prefs.chatCollapsed);
    const widths = panelWidths(window.innerWidth-44, prefs.sidebarWidth, prefs.chatWidth, leftVisible, rightVisible);
    app.classList.toggle('sidebar-collapsed', !leftVisible);
    app.classList.toggle('chat-collapsed', !rightVisible);
    app.style.setProperty('--sidebar-width', (compact?Math.min(320,window.innerWidth-44):widths.left) + 'px');
    app.style.setProperty('--chat-width', (compact?window.innerWidth-44:widths.right) + 'px');
    for (const [id, visible, size] of [['toggleSidebarBtn',leftVisible,widths.left],['toggleChatBtn',rightVisible,widths.right]]) {
      const button = document.getElementById(id);
      button.setAttribute('aria-expanded', String(visible));
      button.title = (visible ? 'Hide ' : 'Show ') + (id === 'toggleSidebarBtn' ? 'Explorer (Ctrl+B)' : 'AI chat (Ctrl+Alt+B)');
    }
    document.getElementById('sidebarResizer').setAttribute('aria-valuenow', String(Math.round(widths.left)));
    document.getElementById('resizer').setAttribute('aria-valuenow', String(Math.round(widths.right)));
    if (cmEditor) requestAnimationFrame(() => cmEditor?.refresh());
  }
  window.toggleSidebar = function () { const focus=app.classList.contains('focus-mode');if(focus)Codebench.toggleFocus(false);if(window.innerWidth<720)compactPanel=compactPanel==='explorer'?null:'explorer';else prefs.sidebarCollapsed = focus ? false : !prefs.sidebarCollapsed; persist(); applyLayout(); };
  window.toggleChat = function () { const focus=app.classList.contains('focus-mode');if(focus)Codebench.toggleFocus(false);if(window.innerWidth<720)compactPanel=compactPanel==='chat'?null:'chat';else prefs.chatCollapsed = focus ? false : !prefs.chatCollapsed; persist(); applyLayout(); };
  window.getWorkbenchPreferences = ()=>({...prefs});
  window.setWorkbenchPreferences = function(values) {Object.assign(prefs,values);persist();app.style.setProperty('--editor-font-size',prefs.fontSize+'px');cmEditor?.setOption('lineWrapping',prefs.wrap);document.getElementById('wrapBtn').setAttribute('aria-pressed',String(prefs.wrap));applyLayout();};
  window.toggleEditorWrap = function () {
    prefs.wrap = !prefs.wrap; persist();
    if (cmEditor) cmEditor.setOption('lineWrapping', prefs.wrap);
    document.getElementById('wrapBtn').setAttribute('aria-pressed', String(prefs.wrap));
  };
  window.changeEditorFont = function (delta) {
    prefs.fontSize = Math.min(24, Math.max(10, prefs.fontSize + delta)); persist();
    app.style.setProperty('--editor-font-size', prefs.fontSize + 'px');
    cmEditor?.refresh();
  };
  window.workbenchEditorOptions = () => ({ lineWrapping:prefs.wrap });
  window.refreshEditorStatus = function () {
    const tab = state.openTabs.find(t => t.path === state.activeTab);
    const cursor = cmEditor?.getCursor() || { line:0, ch:0 };
    const language = tab ? tab.path.split('.').pop().toUpperCase() : 'No file';
    document.getElementById('editorStatus').textContent = tab ? `Ln ${cursor.line+1}, Col ${cursor.ch+1} · Spaces: 2 · UTF-8 · ${language}${tab.modified ? ' · Unsaved' : ''}` : 'No file open';
  };
  window.editorCommand = name => { if (cmEditor) { cmEditor.focus(); cmEditor.execCommand(name); } };
  window.goToLine = function () {
    if (!cmEditor) return;
    const line = prompt('Go to line:', String(cmEditor.getCursor().line + 1));
    if (line === null) return;
    const value = Number(line);
    if (Number.isInteger(value) && value > 0) { cmEditor.setCursor(Math.min(value - 1, cmEditor.lineCount() - 1), 0); cmEditor.focus(); }
  };

  function connectDivider(id, side) {
    const divider = document.getElementById(id);
    let start = null;
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      start = { x:event.clientX, width:side === 'left' ? document.querySelector('.sidebar').offsetWidth : document.querySelector('.chat-pane').offsetWidth };
      divider.setPointerCapture(event.pointerId);
      divider.classList.add('dragging'); document.body.classList.add('resizing'); event.preventDefault();
    });
    divider.addEventListener('pointermove', event => {
      if (!start) return;
      const width = start.width + (event.clientX - start.x) * (side === 'left' ? 1 : -1);
      prefs[side === 'left' ? 'sidebarWidth' : 'chatWidth'] = Math.max(side === 'left' ? 160 : 220, Math.min(width, window.innerWidth - 280));
      applyLayout();
    });
    const end = () => { start=null; divider.classList.remove('dragging'); document.body.classList.remove('resizing'); persist(); };
    divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end); divider.addEventListener('lostpointercapture', end);
    divider.addEventListener('dblclick', () => { prefs[side === 'left' ? 'sidebarWidth' : 'chatWidth'] = side === 'left' ? 240 : 380; persist(); applyLayout(); });
    divider.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return;
      event.preventDefault();
      const key = side === 'left' ? 'sidebarWidth' : 'chatWidth';
      prefs[key] = event.key === 'Home' ? (side === 'left' ? 240 : 380) : Math.max(side === 'left' ? 160 : 220, prefs[key] + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1));
      persist(); applyLayout();
    });
  }

  let quickFiles = [];
  let quickGeneration = 0;
  function flattenTree(nodes, out=[]) { for (const node of nodes) { if (node.type === 'file') out.push(node.path); else flattenTree(node.children || [], out); } return out; }
  window.openQuickFile = async function () {
    document.getElementById('quickOpenModal').classList.remove('hidden');
    const input = document.getElementById('quickOpenInput');
    input.value = ''; input.focus();
    const generation = ++quickGeneration;
    const list = document.getElementById('quickOpenList');
    list.textContent = 'Loading project files…';
    if (!state.rootDir) { list.textContent = 'Open a project folder first.'; return; }
    try {
      const response = await api('/api/files/list', { rootDir:state.rootDir });
      if (generation !== quickGeneration) return;
      quickFiles = flattenTree(response.tree); renderQuickFiles();
    } catch (error) { if (generation === quickGeneration) list.textContent = error.message; }
  };
  window.closeQuickFile = function () { quickGeneration++; document.getElementById('quickOpenModal').classList.add('hidden'); cmEditor?.focus(); };
  function renderQuickFiles() {
    const query = document.getElementById('quickOpenInput').value.trim().toLowerCase();
    const files = quickFiles.filter(file => file.toLowerCase().includes(query)).slice(0,100);
    const list = document.getElementById('quickOpenList'); list.replaceChildren();
    if (!files.length) list.textContent = 'No matching files.';
    for (const file of files) {
      const button = document.createElement('button'); button.textContent = file;
      button.onclick = () => { closeQuickFile(); openFile(file); };
      list.appendChild(button);
    }
  }
  const quickInput = document.getElementById('quickOpenInput');
  quickInput.addEventListener('input', renderQuickFiles);
  document.getElementById('quickOpenModal').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeQuickFile(); }
    if (event.key === 'Enter' && event.target === quickInput) { event.preventDefault(); document.querySelector('#quickOpenList button')?.click(); }
    if (event.key === 'ArrowDown' && event.target === quickInput) { event.preventDefault(); document.querySelector('#quickOpenList button')?.focus(); }
    if (event.key === 'Tab') {
      const elements = [...event.currentTarget.querySelectorAll('input,button')];
      const first=elements[0],last=elements[elements.length-1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('keydown', event => {
    const command = event.ctrlKey || event.metaKey;
    if (!command) return;
    if (event.key.toLowerCase() === 'p') { event.preventDefault(); openQuickFile(); }
    else if (event.key.toLowerCase() === 'b') { event.preventDefault(); if (event.altKey) toggleChat(); else toggleSidebar(); }
    else if (event.key.toLowerCase() === 's') { event.preventDefault(); saveCurrentFile(); }
    else if (event.key.toLowerCase() === 'g') { event.preventDefault(); goToLine(); }
  });
  window.addEventListener('beforeunload', event => {
    if (!state.loading && !state.openTabs.some(tab => tab.modified) && (typeof Explorer==='undefined'||!Explorer.isBusy())) return;
    event.preventDefault(); event.returnValue = '';
  });
  window.addEventListener('resize', applyLayout);
  connectDivider('sidebarResizer','left'); connectDivider('resizer','right');
  app.style.setProperty('--editor-font-size', prefs.fontSize + 'px');
  document.getElementById('wrapBtn').setAttribute('aria-pressed', String(prefs.wrap));
  applyLayout(); refreshEditorStatus();
})();
