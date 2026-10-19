(function () {
  function createChatScroll(container, button, enabled = true) {
    let following = enabled, lastTop = container.scrollTop, anchor, pending = false;
    const atBottom = () => container.scrollHeight - container.clientHeight - container.scrollTop <= 24;
    function capture() {
      const top = container.getBoundingClientRect().top;
      const message = [...container.children].find(el => el.getBoundingClientRect().bottom > top);
      anchor = {index:message?.dataset.messageIndex, offset:message ? message.getBoundingClientRect().top - top : 0, top:container.scrollTop};
    }
    function updateButton() { button.hidden = atBottom(); }
    function restore() {
      if (enabled && following) container.scrollTop = container.scrollHeight;
      else if (anchor) {
        const message = [...container.children].find(el => el.dataset.messageIndex !== undefined && el.dataset.messageIndex === anchor.index);
        container.scrollTop = message ? container.scrollTop + message.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset : anchor.top;
      }
      lastTop = container.scrollTop;
      updateButton();
    }
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; restore(); });
    }
    function jump() {
      following = enabled;
      container.scrollTop = container.scrollHeight;
      lastTop = container.scrollTop;
      capture(); updateButton();
    }
    container.addEventListener('scroll', () => {
      if (container.scrollTop === lastTop) return;
      following = enabled && atBottom();
      lastTop = container.scrollTop;
      capture(); updateButton();
    }, {passive:true});
    // Pause before a wheel movement can race the next streamed chunk.
    container.addEventListener('wheel', event => { if (event.deltaY < 0) { following = false; capture(); } }, {passive:true});
    button.addEventListener('click', jump);
    const resize = new ResizeObserver(schedule);
    function observe() {
      resize.disconnect(); resize.observe(container);
      for (const child of container.children) resize.observe(child, {box:'border-box'});
      schedule();
    }
    new MutationObserver(observe).observe(container, {childList:true,subtree:true,characterData:true});
    capture(); observe();
    return {capture, restore, jump, setEnabled(value) {
      if (enabled === value) return;
      capture(); enabled = value; following = value; restore();
    }};
  }
  if (typeof module !== 'undefined') module.exports = {createChatScroll};
  if (typeof document === 'undefined') return;
  let prefs = {};
  try { prefs = JSON.parse(LaptopStore.getItem('codebenchPreferences') || '{}') || {}; } catch {}
  window.ChatScroll = createChatScroll(document.getElementById('chatMessages'), document.getElementById('jumpToLatest'), prefs.autoFollow !== false);
})();
