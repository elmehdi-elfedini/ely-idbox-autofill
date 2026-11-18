chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error(err));

function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function cleanElyctisDate(raw, isBirthDate) {
  let s = (raw || "").trim();
  if (s.startsWith('="') && s.endsWith('"')) s = s.slice(2, -1);
  else if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  // Excel may export a date formula as =04/08/1995.
  s = s.replace(/^\s*=\s*/, "").trim();

  const parts = s.split("/");
  if (parts.length !== 3) return { dmy: "", iso: "" };

  const [dayRaw, monthRaw, yearRaw] = parts;
  if (!/^\d{1,2}$/.test(dayRaw) || !/^\d{1,2}$/.test(monthRaw) || !/^\d{2,4}$/.test(yearRaw)) {
    return { dmy: "", iso: "" };
  }

  const day = Number(dayRaw);
  const month = Number(monthRaw);
  let year = yearRaw;
  if (yearRaw.length === 2) {
    const yyInt = Number(yearRaw);
    const curYY = new Date().getFullYear() % 100;
    year = isBirthDate
      ? String(yyInt > curYY ? 1900 + yyInt : 2000 + yyInt)
      : String(2000 + yyInt);
  }

  const yyyy = Number(year);
  const leapYear = yyyy % 4 === 0 && (yyyy % 100 !== 0 || yyyy % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    return { dmy: "", iso: "" };
  }

  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const paddedYear = String(yyyy).padStart(4, "0");
  return { dmy: `${dd}/${mm}/${paddedYear}`, iso: `${paddedYear}-${mm}-${dd}` };
}

function parseLatestCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headers = parseCsvLine(lines[0]);
  const lastLine = lines[lines.length - 1];
  const values = parseCsvLine(lastLine);

  const row = {};
  headers.forEach((h, idx) => {
    row[h.trim()] = (values[idx] || "").trim();
  });

  const pick = (k1, k2) => {
    const v = row[k1] || "";
    if (!v || v.toLowerCase().includes("not read")) return row[k2] || "";
    return v;
  };

  const dob = cleanElyctisDate(pick("(DG1)Birth Date", "(MRZ)Birth Date"), true);
  const exp = cleanElyctisDate(pick("(DG1)Expiry Date", "(MRZ)Expiry Date"), false);
  const mrzLines = ["(MRZ)L1", "(MRZ)L2", "(MRZ)L3"]
    .map((header) => row[header] || "")
    .filter(Boolean);
  const mrz = pick("(MRZ)MRZ", "MRZ") || pick("(MRZ)Raw data", "(MRZ)Data") || mrzLines.join("\n");

  const data = {
      firstName: pick("(DG1)Name", "(MRZ)Name"),
      lastName: pick("(DG1)Surname", "(MRZ)Surname"),
      cin: pick("(DG1)Optional Data", "(MRZ)Optional Data"),
      documentNumber: pick("(DG1)Document Number", "(MRZ)Document Number"),
      gender: pick("(DG1)Gender", "(MRZ)Gender"),
      nationality: pick("(DG1)Nationality", "(MRZ)Nationality"),
      mrz,
      birthDateDMY: dob.dmy,
      birthDateISO: dob.iso,
      expiryDateDMY: exp.dmy,
      expiryDateISO: exp.iso
    };

  // Ignore empty CSV rows so they cannot replace the last useful preview.
  if (!Object.values(data).some((value) => String(value || "").trim())) return null;

  return {
    signature: `${lines.length}::${lastLine}`,
    data
  };
}

async function autoDetectCsv() {
  try {
    const res = await fetch("file:///C:/Users/", { cache: "no-store" });
    const html = await res.text();
    const users = new Set();

    const addRowRe = /addRow\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(?:1|true)/gi;
    let m;
    while ((m = addRowRe.exec(html)) !== null) {
      users.add(m[2].replace(/\/+$/, ""));
    }

    if (users.size === 0) {
      const hrefRe = /href=["']([^"'\/\\?#]+)\/?["']/gi;
      while ((m = hrefRe.exec(html)) !== null) {
        users.add(m[1]);
      }
    }

    const skip = new Set(["All%20Users", "All Users", "Default", "Default%20User", "Default User", "Public"]);
    const candidates = [];
    for (const u of users) {
      if (skip.has(u)) continue;
      const encoded = u.includes("%") ? u : encodeURIComponent(u);
      candidates.push(`file:///C:/Users/${encoded}/Documents/ELYCTIS/Extracted%20data.csv`);
      candidates.push(`file:///C:/Users/${encoded}/OneDrive/Documents/ELYCTIS/Extracted%20data.csv`);
    }

    for (const url of candidates) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        const text = await r.text();
        if (text && (text.includes("(DG1)") || text.includes("(MRZ)"))) {
          return { url, text };
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

async function readCsv(fileUrl) {
  const res = await fetch(fileUrl, { cache: "no-store" });
  const text = await res.text();
  return parseLatestCsv(text);
}

async function fillMappedPage(tabId, host, data, mappings) {
  const fieldMap = mappings ? mappings[host] : null;
  if (!fieldMap || Object.keys(fieldMap).length === 0) return false;
  await chrome.tabs.sendMessage(tabId, { type: "APPLY_MAPPINGS", mappings: fieldMap, data });
  return true;
}

async function autoFillTab(tab, data, mappings) {
  if (!tab || !tab.id || !tab.url) return false;
  const urlObj = new URL(tab.url);
  if (urlObj.hostname === "10.0.240.11") {
    if (!urlObj.pathname.includes("/sahty/stepper")) return true;
    return fillSahtyVaadinPage(tab.id, data, urlObj.pathname.includes("/sahty/stepper"));
  }
  return fillMappedPage(tab.id, urlObj.hostname, data, mappings);
}

// Vaadin-aware MAIN-world filler for /sahty/stepper
async function fillSahtyVaadinPage(tabId, data, fillForm) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [data, fillForm],
    func: async (d, fillFormArg) => {
      const normalizeText = (value) =>
        String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const findInput = (hint) => {
        const normalizedHint = normalizeText(hint);
        return Array.from(document.querySelectorAll("input[placeholder]")).find((candidate) =>
          normalizeText(candidate.placeholder).includes(normalizedHint)
        );
      };

      const setVaadinText = (placeholder, val) => {
        const input = findInput(placeholder);
        if (!input || !val || input.value.trim()) return;
        const tf = input.closest("vaadin-text-field");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        if (tf) {
          tf.value = val;
          tf.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };

      const setVaadinPatientSearch = async (val) => {
        let input = null;
        const maxAttempts = 1;
        for (let attempt = 0; attempt < maxAttempts && !input; attempt++) {
          input = Array.from(document.querySelectorAll("input[placeholder]")).find((candidate) => {
            const placeholder = normalizeText(candidate.placeholder);
            return placeholder.startsWith("nom, ") && placeholder.endsWith("ipp ou cin");
          });
          if (!input) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!input || !val) return false;
        if (input.value.trim()) return true;
        const tf = input.closest("vaadin-text-field");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        if (tf) {
          tf.value = val;
          tf.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      };

      const setVaadinDate = async (placeholder, isoVal, dmyVal) => {
        const input = findInput(placeholder);
        if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(isoVal || "") || !dmyVal || input.value.trim()) return;
        const dp = input.closest("vaadin-date-picker");
        if (!dp) return;

        const [yyyy, mm, dd] = isoVal.split("-").map(Number);
        let displayStr = dmyVal;
        if (dp.i18n && typeof dp.i18n.formatDate === "function") {
          try {
            displayStr = dp.i18n.formatDate({ year: yyyy, month: mm - 1, day: dd });
          } catch (_) {}
        }

        dp.value = isoVal;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, displayStr);
        if ("_inputValue" in dp) dp._inputValue = displayStr;

        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        dp.dispatchEvent(
          new CustomEvent("value-changed", {
            detail: { value: isoVal },
            bubbles: true,
            composed: true
          })
        );
        dp.dispatchEvent(new Event("change", { bubbles: true }));
        if (typeof dp.close === "function") dp.close();
      };

      const setVaadinCombo = async (placeholder, patterns) => {
        const input = findInput(placeholder);
        if (!input) return;
        const cb = input.closest("vaadin-combo-box");
        if (!cb) return;
        if (cb.value || cb.selectedItem) return;

        const matchInList = (items) => {
          if (!Array.isArray(items)) return null;
          for (const item of items) {
            const label =
              typeof item === "string"
                ? item
                : item[cb.itemLabelPath || "label"] ?? item.label ?? item.name ?? item.libelle ?? String(item);
            const val =
              typeof item === "string"
                ? item
                : item[cb.itemValuePath || "value"] ?? item.key ?? item.id ?? label;
            if (patterns.some((re) => re.test(normalizeText(label)) || re.test(normalizeText(val)))) {
              return { item, val };
            }
          }
          return null;
        };

        let items = cb.filteredItems && cb.filteredItems.length ? cb.filteredItems : cb.items;
        if (!items || items.length === 0) {
          cb.open();
          await new Promise((r) => setTimeout(r, 250));
          items = cb.filteredItems && cb.filteredItems.length ? cb.filteredItems : cb.items;
        }

        const found = matchInList(items);
        if (found) {
          cb.selectedItem = found.item;
          cb.value = found.val;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          cb.close();
          return;
        }

        cb.open();
        await new Promise((r) => setTimeout(r, 250));
        const overlayItems = document.querySelectorAll("vaadin-combo-box-item");
        for (const el of overlayItems) {
          if (patterns.some((re) => re.test(normalizeText(el.textContent.trim())))) {
            el.click();
            break;
          }
        }
        cb.close();
      };

      // 1. Text & Date fields
      const patientSearch = d.cin || [d.lastName, d.firstName].filter(Boolean).join(" ");
      const searchFound = patientSearch ? await setVaadinPatientSearch(patientSearch) : false;
      if (!fillFormArg) return searchFound;
      setVaadinText("Entrez le nom", d.lastName);
      setVaadinText("Entrez le prenom", d.firstName);
      await setVaadinDate("date de naissance", d.birthDateISO, d.birthDateDMY);

      // 2. Gender
      const isMale = /^(m|h)/i.test(d.gender || "");
      const genderPatterns = isMale
        ? [/^m$/i, /^h$/i, /masculin/i, /homme/i, /^male$/i]
        : [/^f$/i, /feminin/i, /femme/i, /^female$/i];
      await setVaadinCombo("sexe", genderPatterns);

      // 3. Select "CINE" first, then fill N° CIN
      await setVaadinCombo("nature de la piece", [/^cine$/i, /\bcine\b/i]);
      await new Promise((r) => setTimeout(r, 200));
      setVaadinText("Entrez le numero de la piece d'identite", d.cin);
    }
  });
  return Boolean(fillForm || results[0]?.result);
}

let checking = false;
let lastDetectTry = 0;
const appliedSignaturesByPage = new Map();
chrome.storage.session.remove("lastSignature");
chrome.tabs.onRemoved.addListener((tabId) => {
  const prefix = `${tabId}:`;
  for (const key of appliedSignaturesByPage.keys()) {
    if (key.startsWith(prefix)) appliedSignaturesByPage.delete(key);
  }
});

async function autoFillTabOnce(tab, data, mappings, signature) {
  if (!tab?.id || !tab.url) return false;
  const page = new URL(tab.url);
  const mapping = mappings?.[page.hostname];
  if (page.hostname !== "10.0.240.11" && (!mapping || Object.keys(mapping).length === 0)) return false;

  const pageKey = `${tab.id}:${page.origin}${page.pathname}`;
  const previous = appliedSignaturesByPage.get(pageKey);
  if (previous?.signature === signature) {
    if (page.hostname !== "10.0.240.11" || Date.now() - previous.at < 1500) return true;
  }

  const handled = await autoFillTab(tab, data, mappings);
  // Retry Sahty after SPA navigation; setters only fill empty fields.
  if (handled || page.hostname === "10.0.240.11") {
    appliedSignaturesByPage.set(pageKey, { signature, at: Date.now() });
  }
  return handled;
}

async function checkCsvAndUpdate(tab) {
  if (checking) return { fill: false };
  checking = true;

  try {
    const store = await chrome.storage.local.get(["csvFileUrl", "autoFill", "mappings"]);
    let fileUrl = store.csvFileUrl;

    if (!fileUrl) {
      const now = Date.now();
      if (now - lastDetectTry < 1500) return { fill: false, connected: false };
      lastDetectTry = now;
      const found = await autoDetectCsv();
      if (!found) return { fill: false, connected: false };
      fileUrl = found.url;
      const initParsed = parseLatestCsv(found.text);
      await chrome.storage.local.set({
        csvFileUrl: fileUrl
      });
      if (initParsed && store.autoFill !== false && tab) {
        await autoFillTabOnce(tab, initParsed.data, store.mappings, initParsed.signature);
      }
      return {
        fill: false,
        connected: true,
        url: fileUrl,
        data: initParsed ? initParsed.data : null
      };
    }

    let parsed;
    try {
      parsed = await readCsv(fileUrl);
    } catch {
      await chrome.storage.local.remove("csvFileUrl");
      return { fill: false, connected: false };
    }

    if (!parsed) {
      return { fill: false, connected: true, url: fileUrl, data: null };
    }

    if (store.autoFill !== false && tab && tab.url) {
      await autoFillTabOnce(tab, parsed.data, store.mappings, parsed.signature);
    }

    return { fill: false, connected: true, url: fileUrl, data: parsed ? parsed.data : null };
  } finally {
    checking = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "POLL_CSV") {
    checkCsvAndUpdate(sender.tab).then(sendResponse);
    return true;
  }

  if (msg.type === "CHECK_NOW") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await checkCsvAndUpdate(tab || null);
      sendResponse(result);
    })();
    return true;
  }

  if (msg.type === "SET_MANUAL_PATH") {
    (async () => {
      try {
        const parsed = await readCsv(msg.fileUrl);
        await chrome.storage.local.set({ csvFileUrl: msg.fileUrl });
        sendResponse({ ok: true, url: msg.fileUrl, data: parsed ? parsed.data : null });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === "FILL_SAHTY_NOW") {
    fillSahtyVaadinPage(msg.tabId, msg.data, true).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "READ_NOW") {
    (async () => {
      const res = await checkCsvAndUpdate(null);
      sendResponse({ ok: res.connected, url: res.url, data: res.data });
    })();
    return true;
  }
});
