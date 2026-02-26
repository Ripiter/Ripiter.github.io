(() => {
  // ---- helpers ----
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtDDMM = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // v2 adds mode + month support
  const CURRENT_VERSION = 2;

  const WEBHOOK_LS_KEY = "discordWebhookUrl";
  const WORKERURL_LS_KEY = "discordWorkerUrl";

  const parseISODate = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== (m - 1) || dt.getDate() !== d) return null;
    return dt;
  };

  function safeB64EncodeUTF8(str) {
    const utf8 = new TextEncoder().encode(str);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < utf8.length; i += chunk) {
      binary += String.fromCharCode(...utf8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function safeB64DecodeUTF8(b64) {
    const cleaned = (b64 || "").trim().replace(/\s+/g, "");
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function compareEvents(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.startTime || "";
    const tb = b.startTime || "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function center(s, w) {
    const t = String(s);
    if (t.length >= w) return t.slice(0, w);
    const left = Math.floor((w - t.length) / 2);
    const right = w - t.length - left;
    return " ".repeat(left) + t + " ".repeat(right);
  }

  // Wrap text into lines of maxLen.
  function wrapText(text, maxLen) {
    const t = (text ?? "").toString().trim();
    if (!t) return [];
    const words = t.split(/\s+/);
    const lines = [];
    let cur = "";

    for (const w of words) {
      if (!cur) {
        if (w.length <= maxLen) cur = w;
        else {
          for (let i = 0; i < w.length; i += maxLen) lines.push(w.slice(i, i + maxLen));
          cur = "";
        }
      } else {
        if ((cur.length + 1 + w.length) <= maxLen) {
          cur += " " + w;
        } else {
          lines.push(cur);
          cur = "";
          if (w.length <= maxLen) cur = w;
          else {
            for (let i = 0; i < w.length; i += maxLen) lines.push(w.slice(i, i + maxLen));
            cur = "";
          }
        }
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Canvas wrapping by measured width
  function wrapLines(ctx, text, maxWidth) {
    const t = (text || "").toString().trim();
    if (!t) return [];
    const words = t.split(/\s+/);
    const lines = [];
    let cur = "";

    for (const w of words) {
      const candidate = cur ? (cur + " " + w) : w;
      if (ctx.measureText(candidate).width <= maxWidth) {
        cur = candidate;
      } else {
        if (cur) lines.push(cur);
        if (ctx.measureText(w).width <= maxWidth) {
          cur = w;
        } else {
          let part = "";
          for (const ch of w) {
            const cand2 = part + ch;
            if (ctx.measureText(cand2).width <= maxWidth) part = cand2;
            else {
              if (part) lines.push(part);
              part = ch;
            }
          }
          cur = part;
        }
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ISO week helpers
  function getISOWeekStartFromWeekInput(weekValue) {
    const m = /^(\d{4})-W(\d{2})$/.exec(weekValue);
    if (!m) return null;
    const year = Number(m[1]);
    const week = Number(m[2]);

    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7; // Mon=0..Sun=6
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setDate(jan4.getDate() - jan4Day);

    const monday = new Date(mondayWeek1);
    monday.setDate(mondayWeek1.getDate() + (week - 1) * 7);
    return monday;
  }

  function getISOWeekInputValueFromDate(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7; // Mon=0
    date.setDate(date.getDate() - day + 3); // Thursday
    const isoYear = date.getFullYear();

    const jan4 = new Date(isoYear, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7;
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setDate(jan4.getDate() - jan4Day);

    const diffDays = Math.round((date - mondayWeek1) / 86400000);
    const week = 1 + Math.floor(diffDays / 7);
    return `${isoYear}-W${pad2(week)}`;
  }

  function isWithinWeek(date, weekStart) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const ws = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    return d >= ws && d <= we;
  }

  function getMonthStartFromMonthInput(monthValue) {
    // "YYYY-MM" -> Date at first day of month
    const m = /^(\d{4})-(\d{2})$/.exec(monthValue);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (!y || !mo || mo < 1 || mo > 12) return null;
    return new Date(y, mo - 1, 1);
  }

  function getMonthInputValueFromDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;
  }

  function getMonthEnd(monthStart) {
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    return d;
  }

  function isWithinMonth(date, monthStart) {
    const ms = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const me = getMonthEnd(ms);
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return d >= ms && d <= me;
  }

  // ---- Discord helpers (leave as-is, you said it works) ----
  function getStoredWorkerUrl() {
    return (localStorage.getItem(WORKERURL_LS_KEY) || "").trim();
  }
  function getStoredWebhook() {
    return (localStorage.getItem(WEBHOOK_LS_KEY) || "").trim();
  }
  function isLikelyDiscordWebhook(url) {
    return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+/i.test(url);
  }

  // ---- state ----
  let events = [];
  let activeDayIndex = 0;
  let mode = "week"; // "week" | "month"

  // ---- elements ----
  const weekPicker = document.getElementById("weekPicker");
  const prevWeekBtn = document.getElementById("prevWeekBtn");
  const nextWeekBtn = document.getElementById("nextWeekBtn");
  const weekRangeText = document.getElementById("weekRangeText");
  const weekDaysEl = document.getElementById("weekDays");

  const monthPicker = document.getElementById("monthPicker");
  const prevMonthBtn = document.getElementById("prevMonthBtn");
  const nextMonthBtn = document.getElementById("nextMonthBtn");
  const monthRangeText = document.getElementById("monthRangeText");

  const weekControls = document.getElementById("weekControls");
  const monthControls = document.getElementById("monthControls");

  const modeWeekBtn = document.getElementById("modeWeekBtn");
  const modeMonthBtn = document.getElementById("modeMonthBtn");
  const modeHint = document.getElementById("modeHint");

  const dateClampHint = document.getElementById("dateClampHint");

  const selectedDate = document.getElementById("selectedDate");
  const startTime = document.getElementById("startTime");
  const endTime = document.getElementById("endTime");
  const colorEl = document.getElementById("color");
  const nameEl = document.getElementById("name");
  const descEl = document.getElementById("desc");

  const addBtn = document.getElementById("addBtn");
  const clearBtn = document.getElementById("clearBtn");
  const eventsList = document.getElementById("eventsList");

  const genBase64Btn = document.getElementById("genBase64Btn");
  const genAsciiBtn = document.getElementById("genAsciiBtn");
  const base64Out = document.getElementById("base64Out");
  const asciiOut = document.getElementById("asciiOut");
  const asciiLenInfo = document.getElementById("asciiLenInfo");
  const splitAsciiBtn = document.getElementById("splitAsciiBtn");
  const splitBox = document.getElementById("splitBox");

  const copyBase64Btn = document.getElementById("copyBase64Btn");
  const copyAsciiBtn = document.getElementById("copyAsciiBtn");

  const importIn = document.getElementById("importIn");
  const importBtn = document.getElementById("importBtn");
  const importStatus = document.getElementById("importStatus");
  const versionBadge = document.getElementById("versionBadge");

  const webhookInput = document.getElementById("webhookInput");
  const workerInput = document.getElementById("workerInput");
  const saveWebhookBtn = document.getElementById("saveWebhookBtn");
  const clearWebhookBtn = document.getElementById("clearWebhookBtn");
  const webhookStatus = document.getElementById("webhookStatus");
  const sendAsciiBtn = document.getElementById("sendAsciiBtn");
  const sendProgress = document.getElementById("sendProgress");

  const sendImageBtn = document.getElementById("sendImageBtn");
  const sendImageProgress = document.getElementById("sendImageProgress");

  // ---------- Image rendering (Canvas) ----------
  const genImageBtn = document.getElementById("genImageBtn");
  const downloadImageBtn = document.getElementById("downloadImageBtn");
  const copyImageBtn = document.getElementById("copyImageBtn");
  const weekCanvas = document.getElementById("weekCanvas");

  let lastPngBlob = null;

  function setWebhookStatus(msg) {
    if (webhookStatus) webhookStatus.textContent = msg || "";
    console.log(msg);
  }

  function setSendProgress(msg) {
    if (sendProgress) sendProgress.textContent = msg || "";
  }
  function setSendImageProgress(msg) {
    if (sendImageProgress) sendImageProgress.textContent = msg || "";
  }

  function loadWebhookIntoUI() {
    const storedWebhook = getStoredWebhook();
    const storedWorkerURL = getStoredWorkerUrl();

    workerInput.value = storedWorkerURL || "";
    webhookInput.value = storedWebhook || "";

    if (storedWebhook && storedWorkerURL) setWebhookStatus("Webhook + relay key loaded from local storage.");
    else if (storedWebhook) setWebhookStatus("Webhook loaded. Missing relay key.");
    else setWebhookStatus("No webhook saved.");
  }

  function saveWebhookFromUI() {
    const url = (webhookInput.value || "").trim();
    const rk = (workerInput.value || "").trim();

    if (!url) { setWebhookStatus("Nothing to save (missing webhook)."); return; }
    if (!isLikelyDiscordWebhook(url)) { setWebhookStatus("That does not look like a Discord webhook URL."); return; }
    if (!rk) { setWebhookStatus("Relay key is required."); return; }

    localStorage.setItem(WEBHOOK_LS_KEY, url);
    localStorage.setItem(WORKERURL_LS_KEY, rk);
    setWebhookStatus("Webhook + relay key saved locally.");
  }

  function clearWebhook() {
    localStorage.removeItem(WEBHOOK_LS_KEY);
    localStorage.removeItem(WORKERURL_LS_KEY);
    webhookInput.value = "";
    workerInput.value = "";
    setWebhookStatus("Webhook + relay key cleared.");
  }

  // Polish abbreviations
  const dayNames = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

  // ---- mode + period helpers ----
  function getCurrentWeekStart() {
    return getISOWeekStartFromWeekInput(weekPicker.value);
  }
  function getCurrentMonthStart() {
    return getMonthStartFromMonthInput(monthPicker.value);
  }

  function clearOutputs() {
    base64Out.value = "";
    asciiOut.value = "";
    splitBox.style.display = "none";
    splitBox.innerHTML = "";
    asciiLenInfo.textContent = "";
  }

  function setMode(newMode) {
    mode = newMode === "month" ? "month" : "week";

    // Toggle buttons style
    modeWeekBtn.classList.toggle("primary", mode === "week");
    modeMonthBtn.classList.toggle("primary", mode === "month");

    // Show/hide controls
    weekControls.style.display = mode === "week" ? "" : "none";
    monthControls.style.display = mode === "month" ? "" : "none";
    weekDaysEl.style.display = mode === "week" ? "" : "none";

    modeHint.textContent = mode === "week"
      ? "Week mode: add events within selected ISO week (Mon–Sun)."
      : "Month mode: add events within selected month.";

    // Sync pickers from currently selected date
    const d = parseISODate(selectedDate.value) || new Date();

    if (mode === "week") {
      weekPicker.value = getISOWeekInputValueFromDate(d);
      activeDayIndex = 0;
      setWeek(weekPicker.value);
    } else {
      monthPicker.value = getMonthInputValueFromDate(d);
      setMonth(monthPicker.value);
    }

    clearOutputs();
    renderEventsList();
  }

  // ---- week rendering ----
  function setWeek(weekValue) {
    const ws = getISOWeekStartFromWeekInput(weekValue);
    if (!ws) return;
    const we = new Date(ws); we.setDate(ws.getDate() + 6);

    weekRangeText.textContent = `${fmtDDMM(ws)} - ${fmtDDMM(we)} (${toISODate(ws)} … ${toISODate(we)})`;

    weekDaysEl.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(ws.getDate() + i);
      const btn = document.createElement("div");
      btn.className = "dayBtn" + (i === activeDayIndex ? " active" : "");
      btn.innerHTML = `<strong>${dayNames[i]}</strong><span>${fmtDDMM(d)}</span>`;
      btn.addEventListener("click", () => {
        activeDayIndex = i;
        selectedDate.value = toISODate(d);
        [...weekDaysEl.children].forEach((c, idx) => c.classList.toggle("active", idx === activeDayIndex));
        renderEventsList();
      });
      weekDaysEl.appendChild(btn);
    }

    selectedDate.min = toISODate(ws);
    selectedDate.max = toISODate(we);
    dateClampHint.textContent = `Allowed range: ${toISODate(ws)} … ${toISODate(we)}`;

    const d0 = new Date(ws); d0.setDate(ws.getDate() + activeDayIndex);
    selectedDate.value = toISODate(d0);

    renderEventsList();
  }

  function shiftWeek(deltaWeeks) {
    const ws = getCurrentWeekStart();
    if (!ws) return;
    const d = new Date(ws);
    d.setDate(d.getDate() + deltaWeeks * 7);
    weekPicker.value = getISOWeekInputValueFromDate(d);
    activeDayIndex = 0;
    setWeek(weekPicker.value);
    clearOutputs();
  }

  // ---- month rendering ----
  function setMonth(monthValue) {
    const ms = getMonthStartFromMonthInput(monthValue);
    if (!ms) return;
    const me = getMonthEnd(ms);

    monthRangeText.textContent = `${ms.getFullYear()}-${pad2(ms.getMonth() + 1)} (${toISODate(ms)} … ${toISODate(me)})`;

    // Clamp selectedDate to within the month
    selectedDate.min = toISODate(ms);
    selectedDate.max = toISODate(me);

    const cur = parseISODate(selectedDate.value) || new Date();
    let chosen = cur;
    if (!isWithinMonth(cur, ms)) chosen = ms;

    selectedDate.value = toISODate(chosen);
    dateClampHint.textContent = `Allowed range: ${toISODate(ms)} … ${toISODate(me)}`;

    renderEventsList();
  }

  function shiftMonth(deltaMonths) {
    const ms = getCurrentMonthStart();
    if (!ms) return;
    const d = new Date(ms.getFullYear(), ms.getMonth() + deltaMonths, 1);
    monthPicker.value = getMonthInputValueFromDate(d);
    setMonth(monthPicker.value);
    clearOutputs();
  }

  // ---- events UI ----
  function renderEventsList() {
    const filtered = getFilteredEventsForCurrentPeriod()
      .slice()
      .sort(compareEvents);

    eventsList.innerHTML = "";
    if (filtered.length === 0) {
      const p = document.createElement("div");
      p.className = "muted";
      p.textContent = mode === "week"
        ? "No events yet for this week."
        : "No events yet for this month.";
      eventsList.appendChild(p);
      return;
    }

    for (const ev of filtered) {
      const item = document.createElement("div");
      item.className = "eventItem";

      const timeStr = (() => {
        const s = ev.startTime || "";
        const et = (ev.endTime || "").trim();
        if (!et) return s ? s : "(no time)";
        return `${s || "(no start)"}–${et || "(no end)"}`;
      })();

      const metaLines = [];
      metaLines.push(`${timeStr} • ${ev.date}`);
      if (ev.desc) metaLines.push(ev.desc);

      item.innerHTML = `
        <div class="eventTop">
          <div>
            <div class="eventTitle">
              <span class="colorDot" style="background:${escapeHTML(ev.color || "#ffffff")}"></span>
              ${escapeHTML(ev.name || "(no name)")}
            </div>
            <div class="eventMeta">${escapeHTML(metaLines.join("\n"))}</div>
          </div>
          <div class="row gap-8">
            <button class="danger" data-del="${ev.id}">Delete</button>
          </div>
        </div>
      `;

      item.querySelector(`[data-del="${ev.id}"]`).addEventListener("click", () => {
        events = events.filter(x => x.id !== ev.id);
        renderEventsList();
      });

      eventsList.appendChild(item);
    }
  }

  function addEvent() {
    const dateStr = selectedDate.value;
    const d = parseISODate(dateStr);
    if (!d) { alert("Pick a valid date."); return; }

    if (mode === "week") {
      const ws = getCurrentWeekStart();
      if (!ws || !isWithinWeek(d, ws)) {
        alert("Selected date must be within the chosen week (Mon–Sun).");
        return;
      }
    } else {
      const ms = getCurrentMonthStart();
      if (!ms || !isWithinMonth(d, ms)) {
        alert("Selected date must be within the chosen month.");
        return;
      }
    }

    const st = (startTime.value || "").trim() || "00:00";
    const et = (endTime.value || "").trim();
    const nm = (nameEl.value || "").trim();
    const ds = (descEl.value || "").trim();
    const col = (colorEl?.value || "").trim() || "#ffffff";

    if (!nm) { alert("Name is required."); return; }

    events.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      date: dateStr,
      startTime: st,
      endTime: et || "",
      name: nm,
      desc: ds,
      color: col
    });

    startTime.value = "00:00";
    endTime.value = "";
    nameEl.value = "";
    descEl.value = "";

    renderEventsList();
  }

  function getFilteredEventsForCurrentPeriod() {
    if (mode === "week") {
      const ws = getCurrentWeekStart();
      return events.filter(ev => {
        const d = parseISODate(ev.date);
        return d && ws && isWithinWeek(d, ws);
      });
    } else {
      const ms = getCurrentMonthStart();
      return events.filter(ev => {
        const d = parseISODate(ev.date);
        return d && ms && isWithinMonth(d, ms);
      });
    }
  }

  // ---- export/import ----
  function buildExportObject() {
    const filtered = getFilteredEventsForCurrentPeriod()
      .slice()
      .sort(compareEvents);

    if (mode === "week") {
      const ws = getCurrentWeekStart();
      return {
        version: CURRENT_VERSION,
        mode: "week",
        weekStart: toISODate(ws),
        events: filtered.map(ev => ({
          date: ev.date,
          startTime: ev.startTime,
          endTime: ev.endTime || "",
          name: ev.name,
          description: ev.desc || "",
          color: ev.color || ""
        }))
      };
    } else {
      const ms = getCurrentMonthStart();
      return {
        version: CURRENT_VERSION,
        mode: "month",
        month: getMonthInputValueFromDate(ms), // "YYYY-MM"
        events: filtered.map(ev => ({
          date: ev.date,
          startTime: ev.startTime,
          endTime: ev.endTime || "",
          name: ev.name,
          description: ev.desc || "",
          color: ev.color || ""
        }))
      };
    }
  }

  function generateBase64() {
    const obj = buildExportObject();
    const json = JSON.stringify(obj);
    base64Out.value = safeB64EncodeUTF8(json);
  }

  function isoWeekValueFromWeekStartISO(weekStartISO) {
    const ws = parseISODate(weekStartISO);
    if (!ws) return null;
    return getISOWeekInputValueFromDate(ws);
  }

  function normalizeImportedEvent(ev) {
    const date = (ev?.date || "").trim();
    const startTime = (ev?.startTime || "").trim() || "00:00";
    const endTime = (ev?.endTime || "").trim();
    const name = (ev?.name || "").toString().trim();
    const desc = (ev?.description || "").toString().trim();
    const color = (ev?.color || "").toString().trim();

    if (!date || !parseISODate(date)) throw new Error("Invalid event date: " + date);
    if (!name) throw new Error("Event name is required.");

    return {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
      date,
      startTime,
      endTime,
      name,
      desc,
      color: color || "#ffffff"
    };
  }

  function importBase64Replace() {
    try {
      importStatus.textContent = "";
      const b64 = (importIn.value || "").trim();
      if (!b64) throw new Error("Paste a base64 value first.");

      const jsonText = safeB64DecodeUTF8(b64);
      let obj;
      try {
        obj = JSON.parse(jsonText);
      } catch {
        throw new Error("Decoded data is not valid JSON.");
      }

      const version = Number(obj?.version);
      if (!Number.isFinite(version)) throw new Error("Missing/invalid version in JSON.");

      // v1 (legacy): week export only (no mode)
      if (version === 1) {
        const weekStart = (obj?.weekStart || "").trim();
        if (!weekStart || !parseISODate(weekStart)) throw new Error("Missing/invalid weekStart (YYYY-MM-DD).");
        const importedEvents = Array.isArray(obj?.events) ? obj.events : null;
        if (!importedEvents) throw new Error("Missing/invalid events array.");

        const newEvents = importedEvents.map(normalizeImportedEvent);
        const weekVal = isoWeekValueFromWeekStartISO(weekStart);
        if (!weekVal) throw new Error("Could not derive ISO week from weekStart.");

        // Switch UI
        const wsDate = parseISODate(weekStart);
        selectedDate.value = toISODate(wsDate);

        setMode("week");
        weekPicker.value = weekVal;
        activeDayIndex = 0;
        setWeek(weekPicker.value);

        events = newEvents;
        renderEventsList();
        clearOutputs();
        importStatus.textContent = `Imported ${newEvents.length} event(s). (v1 week)`;
        return;
      }

      // v2
      if (version !== 2) throw new Error("Unsupported version: " + version);

      const importedEvents = Array.isArray(obj?.events) ? obj.events : null;
      if (!importedEvents) throw new Error("Missing/invalid events array.");
      const newEvents = importedEvents.map(normalizeImportedEvent);

      const importedMode = (obj?.mode || "").toString().trim();
      if (importedMode !== "week" && importedMode !== "month") {
        throw new Error("Missing/invalid mode in JSON (week|month).");
      }

      events = newEvents;

      if (importedMode === "week") {
        const weekStart = (obj?.weekStart || "").trim();
        if (!weekStart || !parseISODate(weekStart)) throw new Error("Missing/invalid weekStart (YYYY-MM-DD).");
        const weekVal = isoWeekValueFromWeekStartISO(weekStart);
        if (!weekVal) throw new Error("Could not derive ISO week from weekStart.");

        selectedDate.value = weekStart;
        setMode("week");
        weekPicker.value = weekVal;
        activeDayIndex = 0;
        setWeek(weekPicker.value);
      } else {
        const monthVal = (obj?.month || "").trim(); // "YYYY-MM"
        const ms = getMonthStartFromMonthInput(monthVal);
        if (!ms) throw new Error("Missing/invalid month (YYYY-MM).");

        selectedDate.value = toISODate(ms);
        setMode("month");
        monthPicker.value = monthVal;
        setMonth(monthPicker.value);
      }

      renderEventsList();
      clearOutputs();
      importStatus.textContent = `Imported ${newEvents.length} event(s). (v2 ${importedMode})`;

      // auto-generate ASCII preview
      generateASCII();
    } catch (e) {
      importStatus.textContent = (e && e.message) ? e.message : "Import failed.";
      console.log(e);
    }
  }

  // ---- ASCII generation ----
  function formatTimeRange(ev) {
    const st = (ev.startTime || "").trim();
    const et = (ev.endTime || "").trim();
    if (!et) return st;
    return `${st}-${et}`;
  }

  function generateASCII() {
    if (mode === "week") return generateASCIIWeek();
    return generateASCIIMonth();
  }

  function generateASCIIWeek() {
    const ws = getCurrentWeekStart();
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const obj = buildExportObject();

    const byDay = Array.from({ length: 7 }, () => []);
    for (const ev of obj.events) {
      const d = parseISODate(ev.date);
      const idx = (d.getDay() + 6) % 7;
      byDay[idx].push(ev);
    }
    for (let i = 0; i < 7; i++) {
      byDay[i].sort((a, b) =>
        (a.startTime || "").localeCompare(b.startTime || "") ||
        (a.name || "").localeCompare(b.name || "")
      );
    }

    const colW = 9;
    const cellPad = (s) => {
      const t = (s ?? "").toString();
      if (t.length > colW) return t.slice(0, colW);
      return t + " ".repeat(colW - t.length);
    };

    const wrappedByDay = byDay.map(dayEvents => {
      return dayEvents.map(ev => {
        const timeLine = formatTimeRange(ev);
        const nameLines = wrapText(ev.name || "", colW);
        const descLines = wrapText(ev.description || "", colW);
        const lines = [timeLine, ...nameLines, ...descLines, ""];
        return lines;
      });
    });

    const dayHeights = wrappedByDay.map(dayEvents => dayEvents.reduce((sum, eLines) => sum + eLines.length, 0));
    const totalRows = Math.max(0, ...dayHeights);
    const dayStreams = wrappedByDay.map(dayEvents => dayEvents.flat());

    const header = `${fmtDDMM(ws)} - ${fmtDDMM(we)}`;
    const topRule = " " + "_".repeat((colW + 3) * 7 + 1);

    const dayHeader = [
      "|",
      ...dayNames.map(n => " " + cellPad(center(n, colW)) + " " + "|")
    ].join("");

    const sep = [
      "|",
      ...Array.from({ length: 7 }, () => "-" + "-".repeat(colW) + "-" + "|")
    ].join("");

    const rows = [];
    for (let r = 0; r < totalRows; r++) {
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const line = dayStreams[d][r] ?? "";
        cells.push(" " + cellPad(line) + " " + "|");
      }
      rows.push("|" + cells.join(""));
    }

    const bottom = [
      "|",
      ...Array.from({ length: 7 }, () => "_" + "_".repeat(colW) + "_" + "|")
    ].join("");

    const ascii =
`${header}
${topRule}
${dayHeader}
${sep}
${rows.join("\n")}
${bottom}`;

    asciiOut.value = "```text\n" + ascii + "\n```";
    updateAsciiLenInfo();
    splitBox.style.display = "none";
    splitBox.innerHTML = "";
  }

  function generateASCIIMonth() {
    const ms = getCurrentMonthStart();
    const me = getMonthEnd(ms);
    const obj = buildExportObject();

    // Build calendar grid start (Monday-first)
    // Determine the Monday of the week containing the 1st of the month
    const first = new Date(ms.getFullYear(), ms.getMonth(), 1);
    const firstIdx = (first.getDay() + 6) % 7; // Mon=0
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - firstIdx);

    // Determine last date in grid: Sunday of the week containing month end
    const last = new Date(me.getFullYear(), me.getMonth(), me.getDate());
    const lastIdx = (last.getDay() + 6) % 7;
    const gridEnd = new Date(last);
    gridEnd.setDate(last.getDate() + (6 - lastIdx));

    // weeks count
    const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
    const weeks = Math.ceil(totalDays / 7);

    // Map events by ISO date
    const map = new Map();
    for (const ev of obj.events) {
      if (!map.has(ev.date)) map.set(ev.date, []);
      map.get(ev.date).push(ev);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) =>
        (a.startTime || "").localeCompare(b.startTime || "") ||
        (a.name || "").localeCompare(b.name || "")
      );
    }

    // ASCII sizing
    const colW = 18;
    const cellPad = (s) => {
      const t = (s ?? "").toString();
      if (t.length > colW) return t.slice(0, colW);
      return t + " ".repeat(colW - t.length);
    };

    // Prepare per-cell lines, then per-week row heights
    const gridCells = []; // weeks x 7 of arrays of lines
    for (let w = 0; w < weeks; w++) {
      const row = [];
      for (let c = 0; c < 7; c++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + w * 7 + c);
        const inMonth = d.getMonth() === ms.getMonth();
        if (!inMonth) {
          row.push([]); // blank
          continue;
        }

        const iso = toISODate(d);
        const dayNum = pad2(d.getDate());
        const lines = [`${dayNum}`];

        const dayEvents = map.get(iso) || [];
        for (const ev of dayEvents) {
          const t = formatTimeRange(ev) || "";
          if (t) lines.push(t);

          // include color as hex line (month ascii requirement)
          // const col = (ev.color || "").trim();
          // if (col) lines.push(col);

          const nameLines = wrapText(ev.name || "", colW);
          lines.push(...nameLines);

          const desc = (ev.description || "").trim();
          if (desc) {
            const descLines = wrapText(desc, colW);
            lines.push(...descLines);
          }

          lines.push(""); // spacer
        }

        row.push(lines);
      }
      gridCells.push(row);
    }

    // week row heights = max lines among 7 cells
    const rowHeights = gridCells.map(weekRow => Math.max(1, ...weekRow.map(cell => cell.length)));

    const header = `${ms.getFullYear()}-${pad2(ms.getMonth() + 1)} (${toISODate(ms)} … ${toISODate(me)})`;

    const topRule = " " + "_".repeat((colW + 3) * 7 + 1);
    const dayHeader = [
      "|",
      ...dayNames.map(n => " " + cellPad(center(n, colW)) + " " + "|")
    ].join("");
    const sep = [
      "|",
      ...Array.from({ length: 7 }, () => "-" + "-".repeat(colW) + "-" + "|")
    ].join("");

    const outLines = [];
    outLines.push(header);
    outLines.push(topRule);
    outLines.push(dayHeader);
    outLines.push(sep);

    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < rowHeights[w]; r++) {
        const cells = [];
        for (let c = 0; c < 7; c++) {
          const line = (gridCells[w][c][r] ?? "");
          cells.push(" " + cellPad(line) + " " + "|");
        }
        outLines.push("|" + cells.join(""));
      }
      outLines.push(sep);
    }

    const bottom = [
      "|",
      ...Array.from({ length: 7 }, () => "_" + "_".repeat(colW) + "_" + "|")
    ].join("");
    outLines[outLines.length - 1] = bottom; // replace last sep with bottom

    asciiOut.value = "```text\n" + outLines.join("\n") + "\n```";
    updateAsciiLenInfo();
    splitBox.style.display = "none";
    splitBox.innerHTML = "";
  }

  function updateAsciiLenInfo() {
    const len = (asciiOut.value || "").length;
    const ok = len <= 2000;
    asciiLenInfo.innerHTML = `Length: <span class="${ok ? "ok" : "warn"}">${len}</span> / 2000`;
  }

  function buildDiscordMessagesFromAscii(asciiWrapped) {
    const text = (asciiWrapped || "").trim();
    if (!text) return [];

    let inner = text;
    if (inner.startsWith("```")) {
      const lines = inner.split("\n");
      if (lines.length >= 2 && lines[0].startsWith("```")) lines.shift();
      if (lines.length >= 1 && lines[lines.length - 1].trim() === "```") lines.pop();
      inner = lines.join("\n");
    }

    const chunkLimit = 1900;
    const chunks = [];
    let cur = "";

    for (const line of inner.split("\n")) {
      const add = (cur ? "\n" : "") + line;
      if ((cur.length + add.length) > chunkLimit) {
        if (cur) chunks.push(cur);
        if (line.length > chunkLimit) {
          let start = 0;
          while (start < line.length) {
            chunks.push(line.slice(start, start + chunkLimit));
            start += chunkLimit;
          }
          cur = "";
        } else {
          cur = line;
        }
      } else {
        cur += add;
      }
    }
    if (cur) chunks.push(cur);

    return chunks.map(c => "```text\n" + c + "\n```");
  }

  async function postToRelay({ workerUrl, webhookUrl, content, signal, _type }) {
    const resp = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl, content, type : _type }),
      signal
    });

    const txt = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, text: txt };
  }

  let sendAbort = null;

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("Aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function sendAsciiToWebhook() {
    try {
      setWebhookStatus("");
      setSendProgress("");

      const webhookUrl = (getStoredWebhook() || (webhookInput.value || "").trim());
      if (!webhookUrl) { setWebhookStatus("No webhook set. Paste it and click Save."); return; }
      if (!isLikelyDiscordWebhook(webhookUrl)) { setWebhookStatus("Webhook URL format looks wrong."); return; }

      const workerUrl = getStoredWorkerUrl() || (workerInput.value || "").trim();
      if (!workerUrl) { setWebhookStatus("No Worker URL set."); return; }

      const ascii = (asciiOut.value || "").trim();
      if (!ascii) { setWebhookStatus("Generate the ASCII output first."); return; }

      const messages = buildDiscordMessagesFromAscii(ascii);
      if (messages.length === 0) { setWebhookStatus("Nothing to send."); return; }

      sendAsciiBtn.disabled = true;
      sendAbort = new AbortController();

      setSendProgress(`Sending 1/${messages.length}...`);

      for (let i = 0; i < messages.length; i++) {
        if (sendAbort.signal.aborted) throw new Error("Send cancelled.");
        const content = messages[i];
        if (content.length > 2000) throw new Error(`Chunk ${i + 1} exceeds 2000 chars. (length ${content.length})`);

        const res = await postToRelay({
          workerUrl,
          webhookUrl,
          content,
          signal: sendAbort.signal,
          _type : 'text'
        });

        if (!res.ok) {
          throw new Error(`Failed on chunk ${i + 1}: HTTP ${res.status}${res.text ? ` - ${res.text}` : ""}`);
        }

        setSendProgress(`Sent ${i + 1}/${messages.length}`);
        await sleep(350, sendAbort.signal);
      }

      setWebhookStatus(`Sent ${messages.length} message(s) to Discord.`);
      setSendProgress("");
    } catch (e) {
      setWebhookStatus(e?.message || "Send failed.");
    } finally {
      sendAsciiBtn.disabled = false;
      sendAbort = null;
    }
  }

  async function blobToBase64NoPrefix(blob) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return dataUrl.split(",")[1] || "";
  }

  async function sendImageToWorker({ workerUrl, pngBlob, caption }) {
    if (pngBlob.size > 8 * 1024 * 1024) {
      throw new Error("Image is too large (>8MB). Reduce size or content.");
    }

    const dataBase64 = await blobToBase64NoPrefix(pngBlob);

    const resp = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl: webhookInput.value,
        type: "image",
        filename: "week.png",
        mime: "image/png",
        dataBase64,
        content: caption || ""
      })
    });

    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Worker error ${resp.status}: ${txt}`);
  }

  async function downloadLastPng() {
    if (!lastPngBlob) return;
    const url = URL.createObjectURL(lastPngBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (mode === "month") ? "month.png" : "week.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyLastPngToClipboard() {
    if (!lastPngBlob) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      alert("Clipboard image copy not supported in this browser.");
      return;
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": lastPngBlob })]);
  }

  // ---- Canvas drawing helpers (color cards) ----
  function hexToRgba(hex, a) {
    const h = (hex || "").replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(90,167,255,${a})`;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // ---- Week canvas render (updated with event color backgrounds) ----
  function renderWeekToCanvas() {
    const obj = buildExportObject(); // mode-aware, but in week mode this is week payload
    const ws = parseISODate(obj.weekStart);
    if (!ws) { alert("No week selected."); return Promise.resolve(null); }
    const we = new Date(ws); we.setDate(ws.getDate() + 6);

    const byDay = Array.from({ length: 7 }, () => []);
    for (const ev of obj.events) {
      const d = parseISODate(ev.date);
      if (!d) continue;
      const idx = (d.getDay() + 6) % 7;
      byDay[idx].push(ev);
    }
    for (let i = 0; i < 7; i++) {
      byDay[i].sort((a, b) =>
        (a.startTime || "").localeCompare(b.startTime || "") ||
        (a.name || "").localeCompare(b.name || "")
      );
    }

    const W = 1400;
    const padding = 24;
    const headerH = 70;
    const colHeaderH = 46;
    const gridTop = padding + headerH;
    const colW = Math.floor((W - padding * 2) / 7);

    const canvas = weekCanvas;
    const ctx = canvas.getContext("2d");

    const timeFont = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const nameFont = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const descFont = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const cellInnerPad = 10;
    const lineGap = 6;
    const eventGap = 10;

    function measureEventHeight(ev) {
      const maxTextW = colW - cellInnerPad * 2;
      let h = 0;

      ctx.font = timeFont;
      h += 18;

      ctx.font = nameFont;
      const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
      h += nameLines.length * 18;

      const desc = (ev.description || "").trim();
      if (desc) {
        ctx.font = descFont;
        const descLines = wrapLines(ctx, desc, maxTextW);
        h += lineGap + descLines.length * 16;
      }

      h += eventGap;
      return h;
    }

    const dayHeights = byDay.map(dayEvents => {
      let h = 0;
      for (const ev of dayEvents) h += measureEventHeight(ev);
      return Math.max(h, 80);
    });

    const contentH = Math.max(...dayHeights);
    const H = gridTop + colHeaderH + contentH + padding;

    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#111";
    ctx.font = "28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(`${fmtDDMM(ws)} - ${fmtDDMM(we)}`, padding, padding + 34);

    ctx.fillStyle = "#555";
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(`${obj.weekStart} … ${toISODate(we)}`, padding, padding + 56);

    const left = padding;
    const top = gridTop;
    const right = padding + colW * 7;
    const bottom = top + colHeaderH + contentH;

    ctx.strokeStyle = "#cfcfcf";
    ctx.lineWidth = 1;

    ctx.strokeRect(left, top, right - left, bottom - top);

    for (let i = 1; i < 7; i++) {
      const x = left + i * colW;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(left, top + colHeaderH);
    ctx.lineTo(right, top + colHeaderH);
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    for (let i = 0; i < 7; i++) {
      const x0 = left + i * colW;
      const d = new Date(ws); d.setDate(ws.getDate() + i);
      const title = `${dayNames[i]}  ${fmtDDMM(d)}`;
      ctx.fillText(title, x0 + 12, top + 30);
    }

    for (let i = 0; i < 7; i++) {
      const x0 = left + i * colW;
      let y = top + colHeaderH + 14;

      for (const ev of byDay[i]) {
        const maxTextW = colW - cellInnerPad * 2;
        const eventH = measureEventHeight(ev);

        // Background card
        const bgX = x0 + 6;
        const bgY = y - 16;
        const bgW = colW - 12;
        const bgH = Math.max(28, eventH - 6);

        ctx.fillStyle = hexToRgba(ev.color || "#ffffff", 0.18);
        roundRect(ctx, bgX, bgY, bgW, bgH, 10);
        ctx.fill();

        // time
        ctx.fillStyle = "#111";
        ctx.font = timeFont;
        const time = ev.endTime ? `${ev.startTime}-${ev.endTime}` : (ev.startTime || "");
        ctx.fillText(time, x0 + cellInnerPad, y);
        y += 22;

        // name
        ctx.fillStyle = "#111";
        ctx.font = nameFont;
        const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
        for (const line of nameLines) {
          ctx.fillText(line, x0 + cellInnerPad, y);
          y += 22;
        }

        // desc
        const desc = (ev.description || "").trim();
        if (desc) {
          y += 4;
          ctx.fillStyle = "#444";
          ctx.font = descFont;
          const descLines = wrapLines(ctx, desc, maxTextW);
          for (const line of descLines) {
            ctx.fillText(line, x0 + cellInnerPad, y);
            y += 18;
          }
        }

        y += eventGap;
        if (y > bottom - 10) break;
      }
    }

    canvas.style.display = "block";

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        lastPngBlob = blob;
        resolve(blob);
      }, "image/png");
    });
  }

  // ---- Month canvas render (classic calendar grid) ----
  function renderMonthToCanvas() {
    const obj = buildExportObject(); // month payload
    const ms = getCurrentMonthStart();
    if (!ms) { alert("No month selected."); return Promise.resolve(null); }
    const me = getMonthEnd(ms);

    // Grid start (Monday before/at 1st)
    const first = new Date(ms.getFullYear(), ms.getMonth(), 1);
    const firstIdx = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - firstIdx);

    // Grid end (Sunday after/at month end)
    const last = new Date(me.getFullYear(), me.getMonth(), me.getDate());
    const lastIdx = (last.getDay() + 6) % 7;
    const gridEnd = new Date(last);
    gridEnd.setDate(last.getDate() + (6 - lastIdx));

    const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
    const weeks = Math.ceil(totalDays / 7);

    // Group events by date string
    const byDate = new Map();
    for (const ev of obj.events) {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date).push(ev);
    }
    for (const arr of byDate.values()) {
      arr.sort((a, b) =>
        (a.startTime || "").localeCompare(b.startTime || "") ||
        (a.name || "").localeCompare(b.name || "")
      );
    }

    const W = 1400;
    const padding = 24;
    const headerH = 70;
    const colHeaderH = 46;
    const gridTop = padding + headerH;
    const colW = Math.floor((W - padding * 2) / 7);

    const canvas = weekCanvas;
    const ctx = canvas.getContext("2d");

    // Typography
    const titleFont = "28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const smallFont = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const dayNumFont = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const timeFont = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const nameFont = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const descFont = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const cellPad = 10;
    const eventGap = 8;

    // Measure event height in month cells (narrower fonts)
    function measureEventHeight(ev, maxTextW) {
      let h = 0;

      // time
      ctx.font = timeFont;
      h += 16;

      // name
      ctx.font = nameFont;
      const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
      h += nameLines.length * 16;

      // desc
      const desc = (ev.description || "").trim();
      if (desc) {
        ctx.font = descFont;
        const descLines = wrapLines(ctx, desc, maxTextW);
        h += 4 + descLines.length * 14;
      }

      h += eventGap;
      return h;
    }

    // Compute per-week row heights (max cell content height in that row)
    const rowHeights = [];
    for (let w = 0; w < weeks; w++) {
      let maxH = 120; // base height so cells look ok even if empty
      for (let c = 0; c < 7; c++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + w * 7 + c);

        // show all days, but only events for in-month days (your choice: out-of-month blank)
        const inMonth = d.getMonth() === ms.getMonth();
        if (!inMonth) continue;

        const iso = toISODate(d);
        const list = byDate.get(iso) || [];

        const maxTextW = colW - cellPad * 2;
        let h = 24; // day number header space inside cell
        for (const ev of list) h += measureEventHeight(ev, maxTextW);
        maxH = Math.max(maxH, h);
      }
      rowHeights.push(maxH);
    }

    const contentH = rowHeights.reduce((a, b) => a + b, 0);
    const H = gridTop + colHeaderH + contentH + padding;

    canvas.width = W;
    canvas.height = H;

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "#111";
    ctx.font = titleFont;
    ctx.fillText(`${ms.getFullYear()}-${pad2(ms.getMonth() + 1)}`, padding, padding + 34);

    ctx.fillStyle = "#555";
    ctx.font = smallFont;
    ctx.fillText(`${toISODate(ms)} … ${toISODate(me)}`, padding, padding + 56);

    // Grid bounds
    const left = padding;
    const top = gridTop;
    const right = padding + colW * 7;
    const bottom = top + colHeaderH + contentH;

    ctx.strokeStyle = "#cfcfcf";
    ctx.lineWidth = 1;

    // Outer border
    ctx.strokeRect(left, top, right - left, bottom - top);

    // Vertical lines
    for (let i = 1; i < 7; i++) {
      const x = left + i * colW;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    // Header separator
    ctx.beginPath();
    ctx.moveTo(left, top + colHeaderH);
    ctx.lineTo(right, top + colHeaderH);
    ctx.stroke();

    // Day headers
    ctx.fillStyle = "#111";
    ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    for (let i = 0; i < 7; i++) {
      const x0 = left + i * colW;
      ctx.fillText(dayNames[i], x0 + 12, top + 30);
    }

    // Horizontal lines per week
    let yCursor = top + colHeaderH;
    for (let w = 0; w < weeks; w++) {
      const rowH = rowHeights[w];
      const yLine = yCursor + rowH;
      ctx.beginPath();
      ctx.moveTo(left, yLine);
      ctx.lineTo(right, yLine);
      ctx.stroke();
      yCursor = yLine;
    }

    // Cells content
    yCursor = top + colHeaderH;
    for (let w = 0; w < weeks; w++) {
      const rowH = rowHeights[w];

      for (let c = 0; c < 7; c++) {
        const x0 = left + c * colW;

        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + w * 7 + c);

        const inMonth = d.getMonth() === ms.getMonth();
        if (!inMonth) continue; // blank out-of-month cells

        const iso = toISODate(d);
        const list = byDate.get(iso) || [];

        // Day number
        ctx.fillStyle = "#111";
        ctx.font = dayNumFont;
        ctx.fillText(String(d.getDate()), x0 + cellPad, yCursor + 18);

        // Events
        let y = yCursor + 36;
        const maxTextW = colW - cellPad * 2;

        for (const ev of list) {
          // Measure event height to draw background card
          const eventH = (() => {
            let h = 0;
            ctx.font = timeFont; h += 16;
            ctx.font = nameFont;
            const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
            h += nameLines.length * 16;

            const desc = (ev.description || "").trim();
            if (desc) {
              ctx.font = descFont;
              const descLines = wrapLines(ctx, desc, maxTextW);
              h += 4 + descLines.length * 14;
            }
            h += eventGap;
            return h;
          })();

          // Background card
          const bgX = x0 + 6;
          const bgY = y - 14;
          const bgW = colW - 12;
          const bgH = Math.max(22, eventH - 4);

          ctx.fillStyle = hexToRgba(ev.color || "#ffffff", 0.18);
          roundRect(ctx, bgX, bgY, bgW, bgH, 10);
          ctx.fill();

          // time
          ctx.fillStyle = "#111";
          ctx.font = timeFont;
          const t = ev.endTime ? `${ev.startTime}-${ev.endTime}` : (ev.startTime || "");
          if (t) {
            ctx.fillText(t, x0 + cellPad, y);
            y += 18;
          }

          // name
          ctx.fillStyle = "#111";
          ctx.font = nameFont;
          const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
          for (const line of nameLines) {
            ctx.fillText(line, x0 + cellPad, y);
            y += 18;
          }

          // desc
          const desc = (ev.description || "").trim();
          if (desc) {
            y += 2;
            ctx.fillStyle = "#444";
            ctx.font = descFont;
            const descLines = wrapLines(ctx, desc, maxTextW);
            for (const line of descLines) {
              ctx.fillText(line, x0 + cellPad, y);
              y += 16;
            }
          }

          y += eventGap;

          // If we exceed cell height, we still draw (you said "show all");
          // This is why row heights are expanded earlier.
        }
      }

      yCursor += rowH;
    }

    canvas.style.display = "block";

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        lastPngBlob = blob;
        resolve(blob);
      }, "image/png");
    });
  }

  function renderToCanvas() {
    if (mode === "month") return renderMonthToCanvas();
    return renderWeekToCanvas();
  }

  // ---- wiring ----
  async function copyFrom(el) {
    const val = el.value || "";
    if (!val) return;
    await navigator.clipboard.writeText(val);
  }

  addBtn.addEventListener("click", addEvent);
  importBtn.addEventListener("click", importBase64Replace);
  saveWebhookBtn.addEventListener("click", saveWebhookFromUI);
  clearWebhookBtn.addEventListener("click", clearWebhook);
  sendAsciiBtn.addEventListener("click", sendAsciiToWebhook);

  if (sendImageBtn) {
    sendImageBtn.addEventListener("click", async () => {
      try {
        setSendImageProgress("");
        const workerUrl = (workerInput.value || "").trim();
        if (!workerUrl) { alert("Set Worker URL first."); return; }
        if (!lastPngBlob) { alert("Generate image first."); return; }

        await sendImageToWorker({ workerUrl, pngBlob: lastPngBlob, caption: "" });
        setSendImageProgress("Sent.");
        setWebhookStatus("Image sent.");
      } catch (e) {
        setSendImageProgress("Failed.");
        setWebhookStatus(e?.message || "Image send failed.");
      }
    });
  }

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all events for all weeks/months in memory?")) return;
    events = [];
    renderEventsList();
    clearOutputs();
  });

  genBase64Btn.addEventListener("click", generateBase64);
  genAsciiBtn.addEventListener("click", generateASCII);

  copyBase64Btn.addEventListener("click", () => copyFrom(base64Out));
  copyAsciiBtn.addEventListener("click", () => copyFrom(asciiOut));

  asciiOut.addEventListener("input", updateAsciiLenInfo);

  selectedDate.addEventListener("change", () => {
    const d = parseISODate(selectedDate.value);
    if (!d) return;

    if (mode === "week") {
      const ws = getCurrentWeekStart();
      if (!ws) return;

      if (!isWithinWeek(d, ws)) {
        const we = new Date(ws); we.setDate(ws.getDate() + 6);
        const clamped = d < ws ? ws : we;
        selectedDate.value = toISODate(clamped);
      }

      const d2 = parseISODate(selectedDate.value);
      const idx = (d2.getDay() + 6) % 7;
      activeDayIndex = clamp(idx, 0, 6);
      [...weekDaysEl.children].forEach((c, i) => c.classList.toggle("active", i === activeDayIndex));
    } else {
      const ms = getCurrentMonthStart();
      if (!ms) return;

      if (!isWithinMonth(d, ms)) {
        const me = getMonthEnd(ms);
        const clamped = d < ms ? ms : me;
        selectedDate.value = toISODate(clamped);
      }
    }

    renderEventsList();
  });

  weekPicker.addEventListener("change", () => {
    if (mode !== "week") return;
    activeDayIndex = 0;
    setWeek(weekPicker.value);
    clearOutputs();
  });

  monthPicker.addEventListener("change", () => {
    if (mode !== "month") return;
    setMonth(monthPicker.value);
    clearOutputs();
  });

  prevWeekBtn.addEventListener("click", () => { if (mode === "week") shiftWeek(-1); });
  nextWeekBtn.addEventListener("click", () => { if (mode === "week") shiftWeek(+1); });

  prevMonthBtn.addEventListener("click", () => { if (mode === "month") shiftMonth(-1); });
  nextMonthBtn.addEventListener("click", () => { if (mode === "month") shiftMonth(+1); });

  modeWeekBtn.addEventListener("click", () => setMode("week"));
  modeMonthBtn.addEventListener("click", () => setMode("month"));

  // canvas buttons
  if (genImageBtn) genImageBtn.addEventListener("click", async () => { await renderToCanvas(); });
  if (downloadImageBtn) downloadImageBtn.addEventListener("click", downloadLastPng);
  if (copyImageBtn) copyImageBtn.addEventListener("click", copyLastPngToClipboard);

  // ---- init ----
  if (versionBadge) versionBadge.textContent = "v" + CURRENT_VERSION;

  const today = new Date();
  weekPicker.value = getISOWeekInputValueFromDate(today);
  monthPicker.value = getMonthInputValueFromDate(today);

  activeDayIndex = 0;
  selectedDate.value = toISODate(today);

  startTime.value = "00:00";
  loadWebhookIntoUI();

  setMode("week");
})();