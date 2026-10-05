let folderBrowserPath = null;
let folderBrowserParent = null;
let folderBrowserRequest = 0;

async function openFolderBrowser() {
  document.getElementById('folderBrowserModal').classList.remove('hidden');
  document.getElementById('folderDrivesBtn').focus();
  await navigateFolder(state.rootDir || undefined);
}

function closeFolderBrowser() {
  folderBrowserRequest += 1;
  document.getElementById('folderBrowserModal').classList.add('hidden');
  document.getElementById('browseFolderBtn').focus();
}

async function navigateFolder(folderPath) {
  const request = ++folderBrowserRequest;
  const list = document.getElementById('folderBrowserList');
  const status = document.getElementById('folderBrowserStatus');
  const select = document.getElementById('folderSelectBtn');
  const up = document.getElementById('folderUpBtn');
  folderBrowserPath = null;
  select.disabled = true;
  up.disabled = true;
  list.replaceChildren();
  status.textContent = 'Loading folders…';
  try {
    const result = await api('/api/folders/list', { folderPath });
    if (request !== folderBrowserRequest) return;
    folderBrowserPath = result.folderPath;
    folderBrowserParent = result.parentPath;
    document.getElementById('folderBrowserPath').textContent = result.folderPath || 'Local drives';
    up.disabled = !result.folderPath;
    select.disabled = !result.folderPath;
    status.textContent = result.folders.length ? '' : 'No subfolders. You can open this folder.';
    for (const folder of result.folders) {
      const button = document.createElement('button');
      button.type = 'button';
      const icon = document.createElement('i');
      icon.className = 'ti ti-folder';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = folder.name;
      button.append(icon, label);
      button.onclick = () => navigateFolder(folder.path);
      list.appendChild(button);
    }
  } catch (error) {
    if (request !== folderBrowserRequest) return;
    status.textContent = 'Could not browse folders: ' + error.message;
    document.getElementById('folderBrowserPath').textContent = '';
  }
}

async function selectProjectFolder() {
  if (!folderBrowserPath) return;
  document.getElementById('folderSelectBtn').disabled = true;
  document.getElementById('rootDir').value = folderBrowserPath;
  try {
    if (await loadTree()) closeFolderBrowser();
  } finally {
    document.getElementById('folderSelectBtn').disabled = !folderBrowserPath;
  }
}

document.getElementById('folderBrowserModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFolderBrowser();
  }
  if (event.key === 'Tab') {
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
});
