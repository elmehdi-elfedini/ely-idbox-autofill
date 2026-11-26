function setFieldValue(el, val) {
    if (!el || val == null) return;
    if (el.tagName === "SELECT") {
      const low = String(val).toLowerCase();
      const opt = Array.from(el.options).find(
        (o) =>
          o.value.toLowerCase() === low ||
          o.text.toLowerCase() === low ||
          (low === "m" && /homme|masc/i.test(o.text)) ||
          (low === "f" && /femme|fem/i.test(o.text))
      );
      if (opt) {
        el.blur();
        el.value = opt.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    el.blur();
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  
  function applyMappings(fieldMap, data) {
    for (const [key, selector] of Object.entries(fieldMap)) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if (key === "birthDate") {
        setFieldValue(el, el.type === "date" ? data.birthDateISO : data.birthDateDMY);
      } else if (key === "expiryDate") {
        setFieldValue(el, el.type === "date" ? data.expiryDateISO : data.expiryDateDMY);
      } else {
        setFieldValue(el, data[key]);
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "APPLY_MAPPINGS" && msg.mappings && msg.data) {
      applyMappings(msg.mappings, msg.data);
    }
  });

  const navigationType = performance.getEntriesByType("navigation")[0]?.type;
  if (navigationType === "reload") {
    try {
      const pendingMessage = chrome.runtime.sendMessage({ type: "PAGE_REFRESHED" }, () => {
        try {
          void chrome.runtime.lastError;
        } catch (_) {}
      });
      if (pendingMessage && typeof pendingMessage.catch === "function") pendingMessage.catch(() => {});
    } catch (_) {}
  }

  let lastManualEntryNotice = 0;
  const onManualFormEdit = (event) => {
    if (!event.isTrusted || Date.now() - lastManualEntryNotice < 500) return;
    const path = event.composedPath?.() || [event.target];
    const isFormField = path.some(
      (node) =>
        node instanceof Element &&
        node.matches("input, textarea, select, vaadin-text-field, vaadin-combo-box, vaadin-date-picker")
    );
    if (!isFormField) return;

    lastManualEntryNotice = Date.now();
    try {
      const pendingMessage = chrome.runtime.sendMessage({ type: "MANUAL_ENTRY_STARTED" });
      if (pendingMessage && typeof pendingMessage.catch === "function") pendingMessage.catch(() => {});
    } catch (_) {}
  };
  document.addEventListener("beforeinput", onManualFormEdit, true);
  document.addEventListener("input", onManualFormEdit, true);
  document.addEventListener("change", onManualFormEdit, true);
  
  const pollTimer = setInterval(() => {
    if (document.hidden) return;
    try {
      if (!chrome.runtime?.id) {
        clearInterval(pollTimer);
        return;
      }
      const pendingMessage = chrome.runtime.sendMessage(
        { type: "POLL_CSV", host: window.location.hostname },
        () => {
          // Read lastError so a missing/reloaded service worker stays quiet.
          try {
            void chrome.runtime.lastError;
          } catch (_) {}
        }
      );
      // Some Chromium builds also return a promise when a callback is passed.
      // Handle its rejection in case the extension is reloaded mid-request.
      if (pendingMessage && typeof pendingMessage.catch === "function") {
        pendingMessage.catch(() => clearInterval(pollTimer));
      }
    } catch (_) {
      // The extension may be reloaded while this page is still open.
      clearInterval(pollTimer);
    }
  }, 300);
