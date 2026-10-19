(function () {
  function splitMessage(message) {
    const content = String(message.content || '');
    if (message.provider !== 'openui' || message.role !== 'assistant' || message.error) return [{ type:'text', content }];
    const parts = [];
    let end = 0;
    // Match complete fences, including non-UI code, so code examples stay code.
    const fences = /^```([\w-]*)[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?=\r?$)/gm;
    for (const match of content.matchAll(fences)) {
      if (match[1] !== 'openui-lang') continue;
      if (match.index > end) parts.push({ type:'text', content:content.slice(end, match.index) });
      parts.push({ type:'ui', content:match[2].trim() });
      end = match.index + match[0].length;
    }
    if (end < content.length || !parts.length) parts.push({ type:'text', content:content.slice(end) });
    return parts;
  }

  if (typeof module !== 'undefined') module.exports = { splitMessage };
  if (typeof window === 'undefined') return;

  function createView(content) {
    const block = document.createElement('div');
    block.className = 'openui-block';
    const status = document.createElement('p');
    status.className = 'settings-help openui-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Rendering OpenUI response…';
    const frame = document.createElement('iframe');
    frame.className = 'openui-response';
    frame.title = 'Generated OpenUI response';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = 'openui-view.html';
    frame.addEventListener('load', () => {
      frame.contentWindow.postMessage({ type:'openui-render', content }, '*');
      setTimeout(() => {
        if (frame.isConnected && status.textContent === 'Rendering OpenUI response…') {
          status.dataset.failed = 'true';
          status.textContent = 'The renderer did not load. View the response source below.';
          source.open = true;
        }
      }, 8000);
    });
    const source = document.createElement('details');
    source.className = 'openui-source';
    const label = document.createElement('summary');
    label.textContent = 'View UI source';
    const pre = document.createElement('pre');
    pre.textContent = content;
    source.append(label, pre);
    block.append(status, frame, source);
    return block;
  }

  window.addEventListener('message', event => {
    const frame = [...document.querySelectorAll('iframe.openui-response')].find(frame => frame.contentWindow === event.source);
    if (!frame || !event.data || typeof event.data !== 'object') return;
    const status = frame.parentElement.querySelector('.openui-status');
    if (event.data.type === 'openui-height' && Number.isFinite(event.data.height)) {
      frame.style.height = Math.min(2400, Math.max(80, event.data.height)) + 'px';
      if (!status.dataset.failed) status.textContent = '';
    } else if (event.data.type === 'openui-error') {
      status.dataset.failed = 'true';
      status.textContent = 'This view could not be fully rendered. Its source is available below.';
    } else if (event.data.type === 'openui-action' && typeof event.data.text === 'string') {
      const input = document.getElementById('chatInput');
      input.value = event.data.text;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.focus();
      status.textContent = 'Follow-up added to the message box. Review it before sending.';
    } else if (event.data.type === 'openui-action-unavailable') {
      status.textContent = 'This control has no connected action in Draftdrion.';
    }
  });
  window.OpenUIChat = { splitMessage, createView };
  if (typeof renderMessages === 'function' && state.messages.length) renderMessages();
})();
