(() => {
  // ---- helpers ----
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  const CURRENT_VERSION = 1.0;
  const WEBHOOK_LS_KEY = "discordWebhookUrl";
  const WORKERURL_LS_KEY = "discordWorkerUrl";

  function setWebhookStatus(msg) {
    if (webhookStatus) webhookStatus.textContent = msg || "";
    console.log(msg);
  }

  function getStoredWorkerUrl() {
    return (localStorage.getItem(WORKERURL_LS_KEY) || "").trim();
  }
  
  function getStoredWebhook() {
    return (localStorage.getItem(WEBHOOK_LS_KEY) || "").trim();
  }

  function isLikelyDiscordWebhook(url) {
    // Not bulletproof validation, but avoids obvious mistakes.
    // Supports discord.com and discordapp.com
    return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+/i.test(url);
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

function safeB64DecodeUTF8(b64) {
    const cleaned = (b64 || "").trim().replace(/\s+/g, "");
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) 
      bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

  const parseISODate = (s) => {
    if (!s) return null;
    const [y,m,d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m-1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== (m-1) || dt.getDate() !== d) return null;
    return dt;
  };

  const fmtDDMM = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}`;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // ISO week helpers
  function getISOWeekStartFromWeekInput(weekValue) {
    const m = /^(\d{4})-W(\d{2})$/.exec(weekValue);
    if (!m) return null;
    const year = Number(m[1]);
    const week = Number(m[2]);

    // ISO week 1 is the week with Jan 4th in it.
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7; // Monday=0..Sunday=6
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setDate(jan4.getDate() - jan4Day);

    const monday = new Date(mondayWeek1);
    monday.setDate(mondayWeek1.getDate() + (week - 1) * 7);
    return monday;
  }

  function getISOWeekInputValueFromDate(d) {
    const date = new Date(d);
    // Thursday in current week decides the year
    const day = (date.getDay() + 6) % 7; // Mon=0
    date.setDate(date.getDate() - day + 3); // Thursday
    const isoYear = date.getFullYear();

    // Week 1: week containing Jan 4
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

  function safeB64EncodeUTF8(str) {
    const utf8 = new TextEncoder().encode(str);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < utf8.length; i += chunk) {
      binary += String.fromCharCode(...utf8.subarray(i, i + chunk));
    }
    return btoa(binary);
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
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }

  function center(s, w){
    const t = String(s);
    if (t.length >= w) return t.slice(0, w);
    const left = Math.floor((w - t.length)/2);
    const right = w - t.length - left;
    return " ".repeat(left) + t + " ".repeat(right);
  }

  // Wrap text into lines of maxLen.
  // Prefers breaking on spaces; falls back to hard breaks for long words.
  function wrapText(text, maxLen) {
    const t = (text ?? "").toString().trim();
    if (!t) return [];
    const words = t.split(/\s+/);
    const lines = [];
    let cur = "";

    for (const w of words) {
      if (!cur) {
        if (w.length <= maxLen) {
          cur = w;
        } else {
          // hard break word
          for (let i = 0; i < w.length; i += maxLen) {
            lines.push(w.slice(i, i + maxLen));
          }
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
            for (let i = 0; i < w.length; i += maxLen) {
              lines.push(w.slice(i, i + maxLen));
            }
            cur = "";
          }
        }
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ---- state ----
  let events = [];
  let activeDayIndex = 0;

  // ---- elements ----
  const weekPicker = document.getElementById("weekPicker");
  const prevWeekBtn = document.getElementById("prevWeekBtn");
  const nextWeekBtn = document.getElementById("nextWeekBtn");
  const weekRangeText = document.getElementById("weekRangeText");
  const weekDaysEl = document.getElementById("weekDays");

  const selectedDate = document.getElementById("selectedDate");
  const startTime = document.getElementById("startTime");
  const endTime = document.getElementById("endTime");
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

  // ---------- Image rendering (Canvas) ----------
const genImageBtn = document.getElementById("genImageBtn");
const downloadImageBtn = document.getElementById("downloadImageBtn");
const copyImageBtn = document.getElementById("copyImageBtn");
const weekCanvas = document.getElementById("weekCanvas");

let lastPngBlob = null;

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
      // hard-break if single word too long
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



function getISOWeekStartFromWeekInput(weekValue) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekValue);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);

  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7; // Mon=0
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - jan4Day);

  const monday = new Date(mondayWeek1);
  monday.setDate(mondayWeek1.getDate() + (week - 1) * 7);
  return monday;
}

function renderWeekToCanvas() {
  const obj = buildExportObject(); // { version, weekStart, events:[...] }

  const ws = parseISODate(obj.weekStart);
  if (!ws) {
    alert("No week selected.");
    return;
  }
  const we = new Date(ws); we.setDate(ws.getDate() + 6);

  // Group events by day index Mon=0..Sun=6
  const byDay = Array.from({ length: 7 }, () => []);
  for (const ev of obj.events) {
    const d = parseISODate(ev.date);
    if (!d) continue;
    const idx = (d.getDay() + 6) % 7;
    byDay[idx].push(ev);
  }
  for (let i = 0; i < 7; i++) {
    byDay[i].sort((a,b) => (a.startTime||"").localeCompare(b.startTime||"") || (a.name||"").localeCompare(b.name||""));
  }

  // Canvas metrics
  const W = 1400;
  const padding = 24;
  const headerH = 70;
  const colHeaderH = 46;
  const gridTop = padding + headerH;
  const colW = Math.floor((W - padding*2) / 7);

  // Typography
  const canvas = weekCanvas;
  const ctx = canvas.getContext("2d");

  // Pre-calc row heights by measuring wrapped text
  ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const timeFont = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const nameFont = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const descFont = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";

  const cellInnerPad = 10;
  const lineGap = 6;
  const eventGap = 10;

  function measureEventHeight(ev) {
    const maxTextW = colW - cellInnerPad*2;
    let h = 0;

    // time
    ctx.font = timeFont;
    h += 18;

    // name
    ctx.font = nameFont;
    const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
    h += nameLines.length * 18;

    // desc (optional, but default: include if exists)
    const desc = (ev.description || "").trim();
    if (desc) {
      ctx.font = descFont;
      const descLines = wrapLines(ctx, desc, maxTextW);
      h += lineGap + descLines.length * 16;
    }

    h += eventGap; // bottom spacing after event
    return h;
  }

  // Compute per-day required height
  const dayHeights = byDay.map(dayEvents => {
    let h = 0;
    for (const ev of dayEvents) h += measureEventHeight(ev);
    // Minimum height so empty days still look decent
    return Math.max(h, 80);
  });

  const contentH = Math.max(...dayHeights);
  const H = gridTop + colHeaderH + contentH + padding;

  canvas.width = W;
  canvas.height = H;

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#111";
  ctx.font = "28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`${fmtDDMM(ws)} - ${fmtDDMM(we)}`, padding, padding + 34);

  ctx.fillStyle = "#555";
  ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`${obj.weekStart} … ${(() => { const x=new Date(ws); x.setDate(x.getDate()+6); return x.toISOString().slice(0,10); })()}`, padding, padding + 56);

  // Grid lines
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

  // Header separator line
  ctx.beginPath();
  ctx.moveTo(left, top + colHeaderH);
  ctx.lineTo(right, top + colHeaderH);
  ctx.stroke();

  // Column headers
  const dayNames = ["Pn","Wt","Śr","Cz","Pt","So","Nd"];
  ctx.fillStyle = "#111";
  ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto, Arial";

  for (let i = 0; i < 7; i++) {
    const x0 = left + i * colW;
    const d = new Date(ws); d.setDate(ws.getDate() + i);
    const title = `${dayNames[i]}  ${fmtDDMM(d)}`;

    ctx.fillText(title, x0 + 12, top + 30);
  }

  // Events
  for (let i = 0; i < 7; i++) {
    const x0 = left + i * colW;
    let y = top + colHeaderH + 14;

    for (const ev of byDay[i]) {
      const maxTextW = colW - cellInnerPad*2;

      // time line
      ctx.fillStyle = "#111";
      ctx.font = timeFont;
      const time = ev.endTime ? `${ev.startTime}-${ev.endTime}` : (ev.startTime || "");
      ctx.fillText(time, x0 + cellInnerPad, y);
      y += 22;

      // name lines
      ctx.font = nameFont;
      const nameLines = wrapLines(ctx, ev.name || "", maxTextW);
      for (const line of nameLines) {
        ctx.fillText(line, x0 + cellInnerPad, y);
        y += 22;
      }

      // description (if exists)
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

      // Stop drawing if it exceeds content area (rare)
      if (y > bottom - 10) break;
    }
  }

  // Show canvas preview (optional)
  canvas.style.display = "block";

  // Create a blob for download/copy
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      lastPngBlob = blob;
      resolve(blob);
    }, "image/png");
  });
}

async function downloadLastPng() {
  if (!lastPngBlob) return;
  const url = URL.createObjectURL(lastPngBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "week.png";
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
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": lastPngBlob })
  ]);
}

// Wire buttons
if (genImageBtn) genImageBtn.addEventListener("click", async () => { await renderWeekToCanvas(); });
if (downloadImageBtn) downloadImageBtn.addEventListener("click", downloadLastPng);
if (copyImageBtn) copyImageBtn.addEventListener("click", copyLastPngToClipboard);

  if (versionBadge) versionBadge.textContent = "v" + CURRENT_VERSION;

  // Polish 2-letter
  const dayNames = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

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
      });
      weekDaysEl.appendChild(btn);
    }

    selectedDate.min = toISODate(ws);
    selectedDate.max = toISODate(we);

    const d0 = new Date(ws); d0.setDate(ws.getDate() + activeDayIndex);
    selectedDate.value = toISODate(d0);

    renderEventsList();
  }

  function getCurrentWeekStart() {
    return getISOWeekStartFromWeekInput(weekPicker.value);
  }

  function shiftWeek(deltaWeeks) {
    const ws = getCurrentWeekStart();
    if (!ws) return;
    const d = new Date(ws);
    d.setDate(d.getDate() + deltaWeeks * 7);
    weekPicker.value = getISOWeekInputValueFromDate(d);
    activeDayIndex = 0;
    setWeek(weekPicker.value);

    // clear outputs (week-dependent)
    base64Out.value = "";
    asciiOut.value = "";
    splitBox.style.display = "none";
    splitBox.innerHTML = "";
    asciiLenInfo.textContent = "";
  }

  // ---- events UI ----
  function renderEventsList() {
    const ws = getCurrentWeekStart();
    const inWeek = events
      .filter(ev => {
        const d = parseISODate(ev.date);
        return d && isWithinWeek(d, ws);
      })
      .slice()
      .sort(compareEvents);

    eventsList.innerHTML = "";
    if (inWeek.length === 0) {
      const p = document.createElement("div");
      p.className = "muted";
      p.textContent = "No events yet for this week.";
      eventsList.appendChild(p);
      return;
    }

    for (const ev of inWeek) {
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
            <div class="eventTitle">${escapeHTML(ev.name || "(no name)")}</div>
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
    const ws = getCurrentWeekStart();
    if (!ws) return;

    const dateStr = selectedDate.value;
    const d = parseISODate(dateStr);
    if (!d || !isWithinWeek(d, ws)) {
      alert("Selected date must be within the chosen week (Mon–Sun).");
      return;
    }

    const st = (startTime.value || "").trim() || "00:00";
    const et = (endTime.value || "").trim(); // optional

    const nm = (nameEl.value || "").trim();
    const ds = (descEl.value || "").trim();

    if (!nm) { alert("Name is required."); return; }

    events.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      date: dateStr,
      startTime: st,
      endTime: et || "",
      name: nm,
      desc: ds
    });

    // reset inputs (keep date/week). Start time back to 00:00.
    startTime.value = "00:00";
    endTime.value = "";
    nameEl.value = "";
    descEl.value = "";

    renderEventsList();
  }

  function isoWeekValueFromWeekStartISO(weekStartISO) {
  const ws = parseISODate(weekStartISO);
  if (!ws) return null;
  return getISOWeekInputValueFromDate(ws);
}

function normalizeImportedEvent(ev) {
  // Accepts minimal shape and maps to internal model
  const date = (ev?.date || "").trim();
  const startTime = (ev?.startTime || "").trim() || "00:00";
  const endTime = (ev?.endTime || "").trim();
  const name = (ev?.name || "").toString().trim();
  const desc = (ev?.description || "").toString().trim();

  if (!date || !parseISODate(date)) throw new Error("Invalid event date: " + date);
  if (!name) throw new Error("Event name is required.");
  // time validation is intentionally loose; browser allows HH:MM. We keep whatever is provided.
  return {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    date,
    startTime,
    endTime,
    name,
    desc
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
      if (version !== 1) throw new Error("Unsupported version: " + version);

      const weekStart = (obj?.weekStart || "").trim();
      if (!weekStart || !parseISODate(weekStart)) throw new Error("Missing/invalid weekStart (YYYY-MM-DD).");

      const importedEvents = Array.isArray(obj?.events) ? obj.events : null;
      if (!importedEvents) throw new Error("Missing/invalid events array.");

      // Replace events completely (as requested)
      const newEvents = importedEvents.map(normalizeImportedEvent);

      // Switch week picker to the imported weekStart’s ISO week
      const weekVal = isoWeekValueFromWeekStartISO(weekStart);
      if (!weekVal) throw new Error("Could not derive ISO week from weekStart.");

      weekPicker.value = weekVal;
      activeDayIndex = 0;
      setWeek(weekPicker.value);

      events = newEvents;
      renderEventsList();

      // Clear outputs (since week/events changed)
      base64Out.value = "";
      asciiOut.value = "";
      splitBox.style.display = "none";
      splitBox.innerHTML = "";
      asciiLenInfo.textContent = "";

      importStatus.textContent = `Imported ${newEvents.length} event(s).`;

      generateASCII()
    } catch (e) {
      importStatus.textContent = (e && e.message) ? e.message : "Import failed.";
      console.log(e);
    }
  }

  // ---- outputs ----
  function buildExportObject() {
    const ws = getCurrentWeekStart();
    const weekStartISO = toISODate(ws);

    const filtered = events
      .filter(ev => {
        const d = parseISODate(ev.date);
        return d && isWithinWeek(d, ws);
      })
      .slice()
      .sort(compareEvents);

    return {
      version: CURRENT_VERSION,
      weekStart: weekStartISO,
      events: filtered.map(ev => ({
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime || "",
        name: ev.name,
        description: ev.desc || ""
      }))
    };
  }

  function generateBase64() {
    const obj = buildExportObject();
    const json = JSON.stringify(obj);
    base64Out.value = safeB64EncodeUTF8(json);
  }

  function formatTimeRange(ev){
    const st = (ev.startTime || "").trim();
    const et = (ev.endTime || "").trim();
    if (!et) return st;
    return `${st}-${et}`;
  }

  function generateASCII() {
    const ws = getCurrentWeekStart();
    const we = new Date(ws); we.setDate(ws.getDate() + 6);

    const obj = buildExportObject();

    // group per day
    const byDay = Array.from({length:7}, () => []);
    for (const ev of obj.events) {
      const d = parseISODate(ev.date);
      const idx = (d.getDay() + 6) % 7; // Mon=0
      byDay[idx].push(ev);
    }
    for (let i=0;i<7;i++){
      byDay[i].sort((a,b) =>
        (a.startTime||"").localeCompare(b.startTime||"") ||
        (a.name||"").localeCompare(b.name||"")
      );
    }

    // column widths
    const colW = 9; // slightly wider to reduce wrapping
    const cellPad = (s) => {
      const t = (s ?? "").toString();
      if (t.length > colW) return t.slice(0, colW);
      return t + " ".repeat(colW - t.length);
    };

    // Pre-wrap each event into multiple lines: time line, name lines, desc lines, blank spacer
    // This is what fixes truncation and adds description to ASCII.
    const wrappedByDay = byDay.map(dayEvents => {
      return dayEvents.map(ev => {
        const timeLine = formatTimeRange(ev);
        const nameLines = wrapText(ev.name || "", colW);
        const descLines = wrapText(ev.description || "", colW);
        const lines = [timeLine, ...nameLines, ...descLines, ""]; // blank spacer after each event
        return lines;
      });
    });

    // compute how many rows each day needs (sum of lines in events)
    const dayHeights = wrappedByDay.map(dayEvents => dayEvents.reduce((sum, eLines) => sum + eLines.length, 0));
    const totalRows = Math.max(0, ...dayHeights);

    // Flatten per-day line streams for easy row-by-row consumption
    const dayStreams = wrappedByDay.map(dayEvents => dayEvents.flat());

    const header = `${fmtDDMM(ws)} - ${fmtDDMM(we)}`;
    const topRule = " " + "_".repeat((colW+3)*7 + 1);

    const dayHeader = [
      "|",
      ...dayNames.map(n => " " + cellPad(center(n, colW)) + " " + "|")
    ].join("");

    const sep = [
      "|",
      ...Array.from({length:7}, () => "-" + "-".repeat(colW) + "-" + "|")
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
      ...Array.from({length:7}, () => "_"+ "_".repeat(colW) + "_" + "|")
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

  function updateAsciiLenInfo(){
    const len = (asciiOut.value || "").length;
    const ok = len <= 2000;
    asciiLenInfo.innerHTML = `Length: <span class="${ok ? "ok":"warn"}">${len}</span> / 2000`;
  }


function buildDiscordMessagesFromAscii(asciiWrapped) {
  const text = (asciiWrapped || "").trim();
  if (!text) return [];

  // Strip outer fences if present
  let inner = text;
  if (inner.startsWith("```")) {
    const lines = inner.split("\n");
    if (lines.length >= 2 && lines[0].startsWith("```")) lines.shift();
    if (lines.length >= 1 && lines[lines.length - 1].trim() === "```") lines.pop();
    inner = lines.join("\n");
  }

  // We re-wrap each chunk in its own code fence
  const chunkLimit = 1900; // slack for fences
  const chunks = [];
  let cur = "";

  for (const line of inner.split("\n")) {
    const add = (cur ? "\n" : "") + line;
    if ((cur.length + add.length) > chunkLimit) {
      if (cur) chunks.push(cur);

      if (line.length > chunkLimit) {
        // hard-split a long line
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

async function postToRelay({ workerUrl, webhookUrl, content, signal }) {
  const resp = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ webhookUrl, content }),
    signal
  });

  const txt = await resp.text().catch(() => "");
  return { ok: resp.ok, status: resp.status, text: txt };
}

  function splitForDiscord(){
    const text = asciiOut.value || "";
    if (!text) return;

    let inner = text;
    if (inner.startsWith("```")) {
      const lines = inner.split("\n");
      if (lines.length >= 2 && lines[0].startsWith("```")) lines.shift();
      if (lines.length >= 1 && lines[lines.length-1].trim() === "```") lines.pop();
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

    splitBox.style.display = "block";
    splitBox.innerHTML = "";

    chunks.forEach((c, i) => {
      const wrap = "```text\n" + c + "\n```";
      const container = document.createElement("div");
      container.innerHTML = `
        <div class="muted">Message ${i+1} / ${chunks.length} (length ${wrap.length})</div>
        <textarea readonly>${wrap}</textarea>
        <div class="row space-between" style="justify-content:flex-end; gap:8px;">
          <button data-copy-split="${i}">Copy message ${i+1}</button>
        </div>
      `;
      container.querySelector(`[data-copy-split="${i}"]`).addEventListener("click", async () => {
        await navigator.clipboard.writeText(wrap);
      });
      splitBox.appendChild(container);
    });
  }

  function setSendProgress(msg) {
    if (sendProgress) sendProgress.textContent = msg || "";
  }

  async function sendAsciiToWebhook() {
    try {
      setWebhookStatus("");
      setSendProgress("");

      const webhookUrl = (getStoredWebhook() || (webhookInput.value || "").trim());
      if (!webhookUrl) { setWebhookStatus("No webhook set. Paste it and click Save."); return; }
      if (!isLikelyDiscordWebhook(webhookUrl)) { setWebhookStatus("Webhook URL format looks wrong."); return; }
      
      const workerUrl = getStoredWorkerUrl() || (workerUrlInput.value || "").trim();

      if (!workerUrl) {
        setWebhookStatus("No Worker URL set.");
        return false;
      }
      
      const ascii = (asciiOut.value || "").trim();
      if (!ascii) { setWebhookStatus("Generate the ASCII output first."); return; }

      const messages = buildDiscordMessagesFromAscii(ascii);

      // If it’s already <= 2000, this will be a single message anyway.
      if (messages.length === 0) { setWebhookStatus("Nothing to send."); return; }

      // UI state
      sendAsciiBtn.disabled = true;
      // stopSendBtn.disabled = false;
      // stopSendBtn.style.display = "";
      sendAbort = new AbortController();

      setSendProgress(`Sending 1/${messages.length}...`);

      // Sequential send with basic rate-limit handling
      for (let i = 0; i < messages.length; i++) {
        if (sendAbort.signal.aborted) throw new Error("Send cancelled.");

        const content = messages[i];

        // Final hard check (Discord max)
        if (content.length > 2000) {
          throw new Error(`Chunk ${i + 1} exceeds 2000 chars. (length ${content.length})`);
        }

        const res = await postToRelay({
          workerUrl: workerUrl,
          webhookUrl,
          content,
          signal: sendAbort.signal
        });

        // Worker normalizes success to 200 in your setup, but still handle errors
        if (!res.ok) {
          // If your worker returns 429, you can wait and retry.
          // If your worker forwards Discord 429, you may see it here.
          throw new Error(`Failed on chunk ${i + 1}: HTTP ${res.status}${res.text ? ` - ${res.text}` : ""}`);
        }

        setSendProgress(`Sent ${i + 1}/${messages.length}`);

        // Small delay to be polite (reduce rate-limit risk)
        await sleep(350, sendAbort.signal);
      }

      setWebhookStatus(`Sent ${messages.length} message(s) to Discord.`);
      setSendProgress("");
    } catch (e) {
      setWebhookStatus(e?.message || "Send failed.");
    } finally {
      sendAsciiBtn.disabled = false;
      // stopSendBtn.disabled = true;
      // optional: hide stop button when idle
      // stopSendBtn.style.display = "none";
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
  // "data:image/png;base64,AAAA..."
  return dataUrl.split(",")[1] || "";
}

async function sendImageToWorker({ workerUrl, pngBlob, caption }) {
  // Optional guard: keep images reasonably small. Discord limits vary by context; staying well under ~8–10MB is safest.
  // (Your week PNG will usually be far smaller.)
  if (pngBlob.size > 8 * 1024 * 1024) {
    throw new Error("Image is too large (>8MB). Reduce size or content.");
  }

  const dataBase64 = await blobToBase64NoPrefix(pngBlob);

  const resp = await fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookUrl : webhookInput.value,
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

  async function copyFrom(el){
    const val = el.value || "";
    if (!val) return;
    await navigator.clipboard.writeText(val);
  }

  // ---- wiring ----
  addBtn.addEventListener("click", addEvent);
  importBtn.addEventListener("click", importBase64Replace);
  saveWebhookBtn.addEventListener("click", saveWebhookFromUI);
  clearWebhookBtn.addEventListener("click", clearWebhook);
  sendAsciiBtn.addEventListener("click", sendAsciiToWebhook);

  sendImageBtn.addEventListener("click", async () => {
      const workerUrl = (workerInput.value || "").trim();
      if (!workerUrl) { alert("Set Worker URL first."); return; }
      if (!lastPngBlob) { alert("Generate image first."); return; }

      await sendImageToWorker({ workerUrl, pngBlob: lastPngBlob, caption: "" });
      setWebhookStatus("Image send");
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all events for all weeks in memory?")) return;
    events = [];
    renderEventsList();
    base64Out.value = "";
    asciiOut.value = "";
    splitBox.style.display = "none";
    splitBox.innerHTML = "";
    asciiLenInfo.textContent = "";
  });

  genBase64Btn.addEventListener("click", generateBase64);
  genAsciiBtn.addEventListener("click", generateASCII);

  copyBase64Btn.addEventListener("click", () => copyFrom(base64Out));
  copyAsciiBtn.addEventListener("click", () => copyFrom(asciiOut));

  splitAsciiBtn.addEventListener("click", splitForDiscord);
  asciiOut.addEventListener("input", updateAsciiLenInfo);

  selectedDate.addEventListener("change", () => {
    const ws = getCurrentWeekStart();
    if (!ws) return;
    const d = parseISODate(selectedDate.value);
    if (!d) return;

    if (!isWithinWeek(d, ws)) {
      const we = new Date(ws); we.setDate(ws.getDate()+6);
      const clamped = d < ws ? ws : we;
      selectedDate.value = toISODate(clamped);
    }

    const d2 = parseISODate(selectedDate.value);
    const idx = (d2.getDay() + 6) % 7;
    activeDayIndex = clamp(idx, 0, 6);
    [...weekDaysEl.children].forEach((c, i) => c.classList.toggle("active", i === activeDayIndex));
  });

  weekPicker.addEventListener("change", () => {
    activeDayIndex = 0;
    setWeek(weekPicker.value);
    base64Out.value = "";
    asciiOut.value = "";
    splitBox.style.display = "none";
    splitBox.innerHTML = "";
    asciiLenInfo.textContent = "";
  });

  prevWeekBtn.addEventListener("click", () => shiftWeek(-1));
  nextWeekBtn.addEventListener("click", () => shiftWeek(+1));

  // ---- init ----
  const today = new Date();
  weekPicker.value = getISOWeekInputValueFromDate(today);
  activeDayIndex = 0;
  setWeek(weekPicker.value);

  // ensure default start time is 00:00
  startTime.value = "00:00";
  loadWebhookIntoUI();
  
})();