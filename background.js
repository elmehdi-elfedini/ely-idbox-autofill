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
      const organizationOneDrive = encodeURIComponent(
        "OneDrive - Université Mohammed 6 des Sciences et de la Santé"
      );
      candidates.push(
        `file:///C:/Users/${encoded}/${organizationOneDrive}/Documents/ELYCTIS/Extracted%20data.csv`
      );
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

async function autoFillTab(tab, data, mappings, replaceExisting = false) {
  if (!tab || !tab.id || !tab.url) return false;
  const urlObj = new URL(tab.url);
  if (urlObj.hostname === "10.0.240.11") {
    if (!urlObj.pathname.includes("/sahty/stepper")) return false;
    return fillSahtyVaadinPage(tab.id, data, urlObj.pathname.includes("/sahty/stepper"), replaceExisting);
  }
  return fillMappedPage(tab.id, urlObj.hostname, data, mappings);
}

// Vaadin-aware MAIN-world filler for /sahty/stepper
async function fillSahtyVaadinPage(tabId, data, fillForm, replaceExisting = false) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [data, fillForm, replaceExisting],
    func: async (d, fillFormArg, replaceExistingArg) => {
      const normalizeText = (value) =>
        String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const findInput = (hint) => {
        const normalizedHint = normalizeText(hint);
        return Array.from(document.querySelectorAll("input[placeholder]")).find((candidate) =>
          normalizeText(candidate.placeholder).includes(normalizedHint)
        );
      };
      const waitForInput = async (hint, timeoutMs = 5000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const input = findInput(hint);
          if (input) return input;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return findInput(hint);
      };
      const blurFocusedElement = () => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        if (active && active !== document.body && active !== document.documentElement) active.blur?.();
      };
      let manualEntryStarted = false;
      const detectManualEntry = (event) => {
        if (!event.isTrusted) return;
        const path = event.composedPath?.() || [event.target];
        if (path.some((node) => node instanceof Element && node.matches(
          "input, textarea, select, vaadin-text-field, vaadin-combo-box, vaadin-date-picker"
        ))) manualEntryStarted = true;
      };
      const stopDetectingManualEntry = () => {
        document.removeEventListener("beforeinput", detectManualEntry, true);
        document.removeEventListener("input", detectManualEntry, true);
        document.removeEventListener("change", detectManualEntry, true);
      };
      document.addEventListener("beforeinput", detectManualEntry, true);
      document.addEventListener("input", detectManualEntry, true);
      document.addEventListener("change", detectManualEntry, true);

      const setVaadinText = async (placeholder, val) => {
        if (manualEntryStarted) return false;
        if (!String(val || "").trim()) return true;
        const input = await waitForInput(placeholder);
        if (!input || manualEntryStarted) return false;
        const tf = input.closest("vaadin-text-field");
        if (input.value.trim() === String(val).trim() || tf?.value === val) return true;
        if (input.value.trim() && !replaceExistingArg) return true;
        input.blur();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        if (tf) {
          tf.value = val;
          tf.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        }
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return input.value.trim() === String(val).trim() || tf?.value === val;
      };

      const setVaadinPatientSearch = async (val) => {
        let input = null;
        const deadline = Date.now() + 5000;
        while (!input && Date.now() < deadline) {
          input = Array.from(document.querySelectorAll("input[placeholder]")).find((candidate) => {
            const placeholder = normalizeText(candidate.placeholder);
            return placeholder.startsWith("nom, ") && placeholder.endsWith("ipp ou cin");
          });
          if (!input) await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (manualEntryStarted) return false;
        if (!val) return true;
        if (!input) return false;
        const tf = input.closest("vaadin-text-field");
        if (input.value.trim() === String(val).trim() || tf?.value === val) return true;
        if (input.value.trim() && !replaceExistingArg) return true;
        input.blur();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        if (tf) {
          tf.value = val;
          tf.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        }
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return input.value.trim() === String(val).trim() || tf?.value === val;
      };

      const setVaadinDate = async (placeholder, isoVal, dmyVal) => {
        if (manualEntryStarted) return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(isoVal || "") || !dmyVal) return true;
        const input = await waitForInput(placeholder);
        if (!input || manualEntryStarted) return false;
        const dp = input.closest("vaadin-date-picker");
        if (!dp) return false;
        if (dp.value === isoVal) return true;
        if (input.value.trim() && !replaceExistingArg) return true;
        input.blur();

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
        return dp.value === isoVal;
      };

      const setVaadinCombo = async (placeholder, patterns) => {
        const input = await waitForInput(placeholder);
        if (!input || manualEntryStarted) return false;
        const cb = input.closest("vaadin-combo-box");
        if (!cb) return false;
        const currentLabel = normalizeText(
          cb.selectedItem?.[cb.itemLabelPath || "label"] ?? cb.selectedItem?.label ?? cb.value
        );
        if (patterns.some((re) => re.test(currentLabel))) return true;
        const closeCombo = () => {
          // Vaadin hides its overlay on close; move focus first so it is not
          // left inside a subtree marked aria-hidden.
          blurFocusedElement();
          input.blur();
          cb.close();
        };
        if ((cb.value || cb.selectedItem) && !replaceExistingArg) return true;

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

        const deadline = Date.now() + 5000;
        let found = null;
        while (!found && !manualEntryStarted && Date.now() < deadline) {
          const items = cb.filteredItems && cb.filteredItems.length ? cb.filteredItems : cb.items;
          found = matchInList(items);
          if (!found) {
            if (!cb.opened) cb.open();
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        if (manualEntryStarted) {
          closeCombo();
          return false;
        }
        if (found) {
          if (cb.value === found.val || cb.selectedItem === found.item) {
            closeCombo();
            return true;
          }
          cb.selectedItem = found.item;
          cb.value = found.val;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          closeCombo();
          return cb.value === found.val || cb.selectedItem === found.item;
        }

        const overlayItems = document.querySelectorAll("vaadin-combo-box-item");
        let clicked = false;
        for (const el of overlayItems) {
          if (patterns.some((re) => re.test(normalizeText(el.textContent.trim())))) {
            blurFocusedElement();
            input.blur();
            el.click();
            clicked = true;
            break;
          }
        }
        closeCombo();
        if (clicked) {
          await new Promise((r) => setTimeout(r, 150));
          const selectedLabel = normalizeText(
            cb.selectedItem?.[cb.itemLabelPath || "label"] ?? cb.selectedItem?.label ?? cb.value
          );
          return patterns.some((re) => re.test(selectedLabel));
        }
        return false;
      };

      // 1. Text & Date fields
      blurFocusedElement();
      if (manualEntryStarted) {
        stopDetectingManualEntry();
        return { complete: false };
      }
      const patientSearch = d.cin || [d.lastName, d.firstName].filter(Boolean).join(" ");
      const searchFound = patientSearch ? await setVaadinPatientSearch(patientSearch) : true;
      if (!fillFormArg) {
        stopDetectingManualEntry();
        return searchFound;
      }
      if (manualEntryStarted) {
        stopDetectingManualEntry();
        return { complete: false };
      }
      const lastNameSet = await setVaadinText("Entrez le nom", d.lastName);
      if (manualEntryStarted) {
        stopDetectingManualEntry();
        return { complete: false };
      }
      const firstNameSet = await setVaadinText("Entrez le prenom", d.firstName);
      if (manualEntryStarted) {
        stopDetectingManualEntry();
        return { complete: false };
      }
      const birthDateSet = await setVaadinDate("date de naissance", d.birthDateISO, d.birthDateDMY);
      if (manualEntryStarted) {
        stopDetectingManualEntry();
        return { complete: false };
      }

      // 2. Gender
      const isMale = /^(m|h)/i.test(d.gender || "");
      const genderPatterns = isMale
        ? [/^m$/i, /^h$/i, /masculin/i, /homme/i, /^male$/i]
        : [/^f$/i, /feminin/i, /femme/i, /^female$/i];
      const genderSet = d.gender ? await setVaadinCombo("sexe", genderPatterns) : true;
      if (manualEntryStarted) {
        stopDetectingManualEntry();
        return { complete: false };
      }

      // 3. Select "CINE" first, then fill N° CIN
      const documentTypeSet = await setVaadinCombo("nature de la piece", [/^cine$/i, /\bcine\b/i]);
      await new Promise((r) => setTimeout(r, 200));
      const cinSet = await setVaadinText("Entrez le numero de la piece d'identite", d.cin);
      const result = {
        complete: searchFound && lastNameSet && firstNameSet && birthDateSet && genderSet && documentTypeSet && cinSet
      };
      stopDetectingManualEntry();
      return result;
    }
  });
  const result = results[0]?.result;
  return fillForm ? Boolean(result?.complete) : Boolean(result);
}

let checking = false;
let lastDetectTry = 0;
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([
    `lastSignature:${tabId}`,
    `activeSignature:${tabId}`,
    `manualOverride:${tabId}`,
    `awaitingNewScan:${tabId}`
  ]);
});

async function autoFillTabOnce(tab, data, mappings, signature) {
  if (!tab?.id || !tab.url) return false;
  const page = new URL(tab.url);
  const mapping = mappings?.[page.hostname];
  if (page.hostname !== "10.0.240.11" && (!mapping || Object.keys(mapping).length === 0)) return false;

  const signatureKey = `lastSignature:${tab.id}`;
  const activeKey = `activeSignature:${tab.id}`;
  const manualOverrideKey = `manualOverride:${tab.id}`;
  const awaitingKey = `awaitingNewScan:${tab.id}`;
  const stored = await chrome.storage.session.get([signatureKey, activeKey, manualOverrideKey, awaitingKey]);
  const previousSignature = stored[signatureKey];
  const manualOverride = stored[manualOverrideKey];

  if (stored[awaitingKey]) {
    await chrome.storage.session.set({
      [signatureKey]: signature,
      [activeKey]: signature,
      [awaitingKey]: false
    });
    await chrome.storage.session.remove(manualOverrideKey);
    return true;
  }

  if (stored[activeKey] !== signature) {
    await chrome.storage.session.set({ [activeKey]: signature });
  }
  if (previousSignature === signature || manualOverride === signature) return true;
  if (manualOverride) await chrome.storage.session.remove(manualOverrideKey);

  const isNewSignature = previousSignature !== signature;
  const handled = await autoFillTab(tab, data, mappings, isNewSignature);
  if (handled) {
    await chrome.storage.session.set({ [signatureKey]: signature });
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
        signature: initParsed ? initParsed.signature : null,
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
      return { fill: false, connected: true, url: fileUrl, signature: null, data: null };
    }

    if (store.autoFill !== false && tab && tab.url) {
      await autoFillTabOnce(tab, parsed.data, store.mappings, parsed.signature);
    }

    return {
      fill: false,
      connected: true,
      url: fileUrl,
      signature: parsed.signature,
      data: parsed.data
    };
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
    fillSahtyVaadinPage(msg.tabId, msg.data, true, true).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "READ_NOW") {
    (async () => {
      const res = await checkCsvAndUpdate(null);
      sendResponse({ ok: res.connected, url: res.url, data: res.data });
    })();
    return true;
  }

  if (msg.type === "MANUAL_ENTRY_STARTED") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return;
    }
    (async () => {
      const activeKey = `activeSignature:${tabId}`;
      const completedKey = `lastSignature:${tabId}`;
      const stored = await chrome.storage.session.get([activeKey, completedKey]);
      const signature = stored[activeKey] || stored[completedKey];
      if (signature) {
        await chrome.storage.session.set({ [`manualOverride:${tabId}`]: signature });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "PAGE_REFRESHED") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return;
    }
    (async () => {
      const signatureKey = `lastSignature:${tabId}`;
      const activeKey = `activeSignature:${tabId}`;
      const awaitingKey = `awaitingNewScan:${tabId}`;
      const manualOverrideKey = `manualOverride:${tabId}`;
      await chrome.storage.session.set({ [awaitingKey]: true });
      await chrome.storage.session.remove(manualOverrideKey);

      const result = await checkCsvAndUpdate(null);
      if (result.signature) {
        await chrome.storage.session.set({
          [signatureKey]: result.signature,
          [activeKey]: result.signature,
          [awaitingKey]: false
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
