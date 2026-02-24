(() => {
  // ---- helpers ----
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

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

  // ---- state ----
  let events = [];
  let activeDayIndex = 0;

  // ---- elements ----
  const weekPicker = document.getElementById("weekPicker");
  const weekRangeText = document.getElementById("weekRangeText");
  const weekDaysEl = document.getElementById("weekDays");

  const selectedDate = document.getElementById("selectedDate");
  const startTime = document.getElementById("startTime");
  const endDate = document.getElementById("endDate");
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
    endDate.min = toISODate(ws);
    endDate.max = toISODate(we);

    const d0 = new Date(ws); d0.setDate(ws.getDate() + activeDayIndex);
    selectedDate.value = toISODate(d0);

    renderEventsList();
  }

  function getCurrentWeekStart() {
    return getISOWeekStartFromWeekInput(weekPicker.value);
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
        const hasEnd = (ev.endDate && ev.endTime) || ev.endTime || ev.endDate;
        if (!hasEnd) return s ? s : "(no time)";
        const ed = ev.endDate || ev.date;
        const et = ev.endTime || "";
        const sameDay = ed === ev.date;
        if (sameDay) return `${s || "(no start)"}–${et || "(no end)"}`;
        return `${ev.date} ${s || ""} → ${ed} ${et || ""}`.trim();
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

    const st = (startTime.value || "").trim();
    const nm = (nameEl.value || "").trim();
    const ds = (descEl.value || "").trim();

    if (!nm) { alert("Name is required."); return; }
    if (!st) { alert("Start time is required."); return; }

    let ed = (endDate.value || "").trim();
    let et = (endTime.value || "").trim();
    if (!ed && et) ed = dateStr;

    if (ed) {
      const edd = parseISODate(ed);
      if (!edd || !isWithinWeek(edd, ws)) {
        alert("End date must be within the chosen week (Mon–Sun).");
        return;
      }
    }

    events.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      date: dateStr,
      startTime: st,
      endDate: ed || "",
      endTime: et || "",
      name: nm,
      desc: ds
    });

    startTime.value = "";
    endDate.value = "";
    endTime.value = "";
    nameEl.value = "";
    descEl.value = "";

    renderEventsList();
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
      version: 1,
      weekStart: weekStartISO,
      events: filtered.map(ev => ({
        date: ev.date,
        startTime: ev.startTime,
        endDate: ev.endDate || "",
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
    const hasAnyEnd = (ev.endDate && ev.endTime) || ev.endTime || ev.endDate;
    if (!hasAnyEnd) return st;

    const ed = (ev.endDate || ev.date || "").trim();
    const et = (ev.endTime || "").trim();

    if (ed === ev.date) {
      if (st && et) return `${st}-${et}`;
      if (st && !et) return `${st}-?`;
      if (!st && et) return `?-` + et;
      return "";
    }

    const sd = parseISODate(ev.date);
    const edd = parseISODate(ed);
    const sds = sd ? fmtDDMM(sd) : ev.date;
    const eds = edd ? fmtDDMM(edd) : ed;
    return `${sds}${st ? " "+st : ""}→${eds}${et ? " "+et : ""}`.trim();
  }

  function generateASCII() {
    const ws = getCurrentWeekStart();
    const we = new Date(ws); we.setDate(ws.getDate() + 6);

    const obj = buildExportObject();
    const byDay = Array.from({length:7}, () => []);
    for (const ev of obj.events) {
      const d = parseISODate(ev.date);
      const idx = (d.getDay() + 6) % 7; // Mon=0
      byDay[idx].push(ev);
    }
    for (let i=0;i<7;i++){
      byDay[i].sort((a,b) => (a.startTime||"").localeCompare(b.startTime||"") || (a.name||"").localeCompare(b.name||""));
    }

    const maxEvents = Math.max(0, ...byDay.map(a => a.length));
    const rowBlocks = maxEvents * 3;

    const header = `${fmtDDMM(ws)} - ${fmtDDMM(we)}`;

    const colW = 11;
    const cellPad = (s) => {
      const t = (s ?? "").toString();
      if (t.length > colW) return t.slice(0, colW);
      return t + " ".repeat(colW - t.length);
    };

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
    for (let r = 0; r < rowBlocks; r++) {
      const eventIndex = Math.floor(r / 3);
      const subRow = r % 3;
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const ev = byDay[d][eventIndex];
        let text = "";
        if (ev) {
          if (subRow === 0) text = formatTimeRange(ev);
          else if (subRow === 1) text = ev.name || "";
          else text = "";
        }
        cells.push(" " + cellPad(text) + " " + "|");
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

  async function copyFrom(el){
    const val = el.value || "";
    if (!val) return;
    await navigator.clipboard.writeText(val);
  }

  // ---- wiring ----
  addBtn.addEventListener("click", addEvent);

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

  endDate.addEventListener("change", () => {
    const ws = getCurrentWeekStart();
    if (!ws) return;
    const d = parseISODate(endDate.value);
    if (!d) return;

    if (!isWithinWeek(d, ws)) {
      const we = new Date(ws); we.setDate(ws.getDate()+6);
      const clamped = d < ws ? ws : we;
      endDate.value = toISODate(clamped);
    }
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

  // ---- init ----
  const today = new Date();
  weekPicker.value = getISOWeekInputValueFromDate(today);
  activeDayIndex = 0;
  setWeek(weekPicker.value);

})();