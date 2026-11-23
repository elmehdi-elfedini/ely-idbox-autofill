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
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
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

  let autoFillEnabled = true;
  let lastAutofilledPatientSearch = "";
  chrome.storage.local.get("autoFill", (store) => {
    autoFillEnabled = store.autoFill !== false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.autoFill) {
      autoFillEnabled = changes.autoFill.newValue !== false;
    }
  });

  function fillSahtyPatientSearch(data) {
    if (!data) return;
    const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const input = Array.from(document.querySelectorAll("input[placeholder]")).find((candidate) => {
      const placeholder = normalize(candidate.placeholder);
      return placeholder.startsWith("nom, ") && placeholder.endsWith("ipp ou cin");
    });
    const query = data.cin || [data.lastName, data.firstName].filter(Boolean).join(" ");
    if (!query) return;
    const currentValue = input?.value.trim() || "";
    if (!input || (currentValue && currentValue !== lastAutofilledPatientSearch && currentValue !== query)) return;
    if (currentValue === query) {
      lastAutofilledPatientSearch = query;
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    const textField = input.closest("vaadin-text-field");
    if (textField) {
      textField.value = query;
    }
    lastAutofilledPatientSearch = query;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "APPLY_MAPPINGS" && msg.mappings && msg.data) {
      applyMappings(msg.mappings, msg.data);
    }
  });
  
  setInterval(() => {
    if (document.hidden) return;
    chrome.runtime.sendMessage(
      { type: "POLL_CSV", host: window.location.hostname },
      (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (autoFillEnabled) fillSahtyPatientSearch(res.data);
        if (res.fill) applyMappings(res.mappings, res.data);
      }
    );
  }, 300);
