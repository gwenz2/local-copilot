(function () {
  const rootElement = document.getElementById('root');
  const send = data => parent.postMessage(data, '*');
  const fail = () => send({ type:'openui-error' });
  let root;
  window.addEventListener('error', fail);
  window.addEventListener('unhandledrejection', fail);
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'openui-render' || typeof event.data.content !== 'string') return;
    try {
      const { React, createRoot, Renderer, openuiChatLibrary } = window.__OpenUI;
      root ||= createRoot(rootElement, { onUncaughtError:fail });
      root.render(React.createElement(Renderer, {
        response:event.data.content,
        library:openuiChatLibrary,
        isStreaming:false,
        onError:errors => { if (errors.some(error => error.severity !== 'warning')) fail(); },
        onAction:action => {
          const text = action.humanFriendlyMessage;
          if (action.type === 'continue_conversation' && typeof text === 'string') send({ type:'openui-action', text });
          else send({ type:'openui-action-unavailable' });
        },
      }));
      setTimeout(() => { if (!rootElement.childElementCount) fail(); }, 5000);
    } catch { fail(); }
  });
  new ResizeObserver(() => {
    if (rootElement.childElementCount) send({ type:'openui-height', height:Math.ceil(rootElement.getBoundingClientRect().height) + 8 });
  }).observe(rootElement);
})();
