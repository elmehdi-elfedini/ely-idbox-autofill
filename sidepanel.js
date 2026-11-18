const FIELDS = [
    { key: "lastName", label: "Nom" },
    { key: "firstName", label: "Prénom" },
    { key: "cin", label: "N° CIN" },
    { key: "birthDate", label: "Date de naissance" },
    { key: "expiryDate", label: "Date d’expiration" },
    { key: "gender", label: "Sexe" },
    { key: "nationality", label: "Nationalité" },
    { key: "documentNumber", label: "N° du document" },
    { key: "mrz", label: "MRZ" }
  ];

  function formatMrz(value) {
    const lines = String(value || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim().toUpperCase())
      .filter(Boolean);

    if (lines.length === 1) {
      const raw = lines[0].replace(/\s/g, "");
      const lineLength = raw.length / 3;
      if ([30, 36, 44].includes(lineLength)) {
        return [raw.slice(0, lineLength), raw.slice(lineLength, lineLength * 2), raw.slice(lineLength * 2)].join("\n");
      }
    }

    return lines.join("\n");
  }
  
  let currentPreviewKey;
  function showPreview(data) {
    const card = document.getElementById("dataCard");
    const hasData = data && Object.values(data).some((value) => String(value || "").trim());
    const previewKey = hasData ? JSON.stringify(data) : "";
    if (previewKey === currentPreviewKey) return;
    currentPreviewKey = previewKey;

    if (!hasData) {
      card.classList.add("hidden");
      return;
    }
    card.classList.remove("hidden");
    const full = [data?.firstName, data?.lastName].filter(Boolean).join(" ");
    document.getElementById("pvFullName").textContent = full;
    document.getElementById("pvCin").textContent = data?.cin || "";
    document.getElementById("pvBirth").textContent = data?.birthDateDMY || "";
    document.getElementById("pvExpiry").textContent = data?.expiryDateDMY || "";
    document.getElementById("pvGender").textContent = data?.gender || "";
    document.getElementById("pvMrz").textContent = formatMrz(data?.mrz);
  }
  
  function setStatus(connected, url, hasData) {
    const el = document.getElementById("statusText");
    if (!hasData) {
      el.textContent = "";
      el.title = "";
    } else if (connected && url) {
      el.textContent = "Prêt";
      el.title = decodeURIComponent(url.replace("file:///", ""));
    } else {
      el.textContent = "Recherche…";
      el.title = "Recherche de Documents\\ELYCTIS\\Extracted data.csv";
    }
  }
  
  document.getElementById("chkAutoFill").addEventListener("change", (e) => {
    chrome.storage.local.set({ autoFill: e.target.checked });
  });
  
  document.getElementById("btnManualSave").addEventListener("click", () => {
    let raw = document.getElementById("manualPath").value.trim().replace(/^"+|"+$/g, "");
    if (!raw) return;
    raw = raw.replace(/\\/g, "/");
    const fileUrl = raw.startsWith("file://")
      ? new URL(raw).href
      : new URL("file:///" + raw.replace(/^\/+/, "")).href;
  
    chrome.runtime.sendMessage({ type: "SET_MANUAL_PATH", fileUrl }, (res) => {
      if (res && res.ok) {
        setStatus(true, res.url, Boolean(res.data));
        showPreview(res.data);
      }
    });
  });
  
  async function getActiveTabInfo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith("http")) return null;
    const u = new URL(tab.url);
    return { tabId: tab.id, host: u.hostname, url: tab.url };
  }
  
  async function getMappings(host) {
    const res = await chrome.storage.local.get("mappings");
    return (res.mappings && res.mappings[host]) || {};
  }
  
  async function saveMapping(host, fieldKey, selector) {
    const res = await chrome.storage.local.get("mappings");
    const all = res.mappings || {};
    all[host] = all[host] || {};
    if (selector) all[host][fieldKey] = selector;
    else delete all[host][fieldKey];
    await chrome.storage.local.set({ mappings: all });
    renderMappings();
  }
  
  async function renderMappings() {
    const info = await getActiveTabInfo();
    const hostEl = document.getElementById("siteHost");
    const listEl = document.getElementById("mappingList");
  
    if (!info) {
      hostEl.textContent = "Ouvrez un site web";
      listEl.innerHTML = "";
      return;
    }
  
    if (info.host === "10.0.240.11" && info.url.includes("/sahty/stepper")) {
      hostEl.textContent = "Sahty Stepper";
      listEl.innerHTML = `<div class="muted" style="padding:4px 0;">Configuration prête pour Sahty Stepper.</div>`;
      return;
    }
  
    const map = await getMappings(info.host);
    const count = Object.keys(map).length;
    hostEl.textContent = count > 0 ? `${info.host} (${count} champs)` : info.host;
    listEl.innerHTML = "";
  
    FIELDS.forEach((f) => {
      const row = document.createElement("div");
      row.className = "map-row";
  
      const left = document.createElement("div");
      left.className = "map-info";
      const name = document.createElement("div");
      name.className = "map-name";
      name.textContent = f.label;
      const sel = document.createElement("div");
      sel.className = "map-sel";
      sel.textContent = map[f.key] || "Non défini";
      sel.title = map[f.key] || "";
      left.append(name, sel);
  
      const pickBtn = document.createElement("button");
      pickBtn.className = "btn-pick";
      pickBtn.textContent = "Choisir";
      pickBtn.addEventListener("click", () => startPicker(info.tabId, info.host, f.key));
      row.append(left, pickBtn);
  
      if (map[f.key]) {
        const clrBtn = document.createElement("button");
        clrBtn.className = "btn-clear";
        clrBtn.textContent = "×";
        clrBtn.addEventListener("click", () => saveMapping(info.host, f.key, null));
        row.append(clrBtn);
      }
  
      listEl.append(row);
    });
  }
  
  async function startPicker(tabId, host, fieldKey) {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [host, fieldKey],
      func: (hostArg, fieldKeyArg) => {
        if (window.__cinPickerCleanup) window.__cinPickerCleanup();
  
        const getSelector = (el) => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const name = el.getAttribute("name");
          if (name && document.querySelectorAll(`[name="${CSS.escape(name)}"]`).length === 1) {
            return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
          }
          const path = [];
          let cur = el;
          while (cur && cur.nodeType === 1 && cur !== document.body) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) {
              path.unshift(`#${CSS.escape(cur.id)}`);
              break;
            }
            const sibs = cur.parentNode
              ? Array.from(cur.parentNode.children).filter((c) => c.tagName === cur.tagName)
              : [];
            if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
            path.unshift(part);
            cur = cur.parentNode;
          }
          return path.join(" > ");
        };
  
        let hovered = null;
        let prevOutline = "";
  
        const onOver = (e) => {
          const t = e.target.closest("input, select, textarea");
          if (hovered && hovered !== t) {
            hovered.style.outline = prevOutline;
            hovered = null;
          }
          if (t && t !== hovered) {
            hovered = t;
            prevOutline = t.style.outline;
            t.style.outline = "2px solid #111827";
          }
        };
  
        const cleanup = () => {
          if (hovered) hovered.style.outline = prevOutline;
          document.removeEventListener("mouseover", onOver, true);
          document.removeEventListener("click", onClick, true);
          document.removeEventListener("keydown", onKey, true);
          window.__cinPickerCleanup = null;
        };
  
        const onClick = (e) => {
          const t = e.target.closest("input, select, textarea");
          if (!t) return;
          e.preventDefault();
          e.stopPropagation();
          const selector = getSelector(t);
          cleanup();
          chrome.runtime.sendMessage({
            type: "CIN_PICKED_FIELD",
            host: hostArg,
            fieldKey: fieldKeyArg,
            selector
          });
        };
  
        const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  
        window.__cinPickerCleanup = cleanup;
        document.addEventListener("mouseover", onOver, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
      }
    });
  }
  
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CIN_PICKED_FIELD") {
      saveMapping(msg.host, msg.fieldKey, msg.selector);
    }
  });
  
  document.getElementById("btnFillNow").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "READ_NOW" }, async (res) => {
      if (!res || !res.ok || !res.data) return;
      setStatus(true, res.url, Boolean(res.data));
      showPreview(res.data);
  
      const info = await getActiveTabInfo();
      if (!info) return;
  
      if (info.host === "10.0.240.11" && info.url.includes("/sahty/stepper")) {
        chrome.runtime.sendMessage({ type: "FILL_SAHTY_NOW", tabId: info.tabId, data: res.data });
        return;
      }
  
      const fieldMap = await getMappings(info.host);
      if (Object.keys(fieldMap).length === 0) return;
  
      await chrome.scripting.executeScript({
        target: { tabId: info.tabId },
        args: [fieldMap, res.data],
        func: (map, data) => {
          const setVal = (el, val) => {
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
            const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          };
  
          for (const [k, sel] of Object.entries(map)) {
            const el = document.querySelector(sel);
            if (!el) continue;
            if (k === "birthDate") setVal(el, el.type === "date" ? data.birthDateISO : data.birthDateDMY);
            else if (k === "expiryDate") setVal(el, el.type === "date" ? data.expiryDateISO : data.expiryDateDMY);
            else setVal(el, data[k]);
          }
        }
      });
    });
  });
  
  chrome.tabs.onActivated.addListener(renderMappings);
  chrome.tabs.onUpdated.addListener((_, change) => {
    if (change.status === "complete") renderMappings();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.csvFileUrl) setStatus(Boolean(changes.csvFileUrl.newValue), changes.csvFileUrl.newValue, false);
  });
  
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "CHECK_NOW" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      setStatus(res.connected, res.url, Boolean(res.data));
      showPreview(res.data);
    });
  }, 400);
  
  (async () => {
    chrome.extension.isAllowedFileSchemeAccess((allowed) => {
      if (!allowed) document.getElementById("fileAccessWarn").classList.remove("hidden");
    });
  
    const store = await chrome.storage.local.get(["csvFileUrl", "autoFill"]);
    // Remove scan data saved by older extension versions.
    await chrome.storage.local.remove(["lastData", "lastSignature"]);
    if (store.autoFill === false) document.getElementById("chkAutoFill").checked = false;
    showPreview(null);
    if (store.csvFileUrl) setStatus(true, store.csvFileUrl, false);
  
    renderMappings();
  })();
