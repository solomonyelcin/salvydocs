(() => {
  "use strict";
  const CFG = window.GALLERY_CONFIG || {};
  const ROOT = { id: CFG.ROOT_FOLDER_ID, name: CFG.ROOT_NAME || "Gallery" };
  const API = "https://www.googleapis.com/drive/v3";
  const FOLDER = "application/vnd.google-apps.folder";
  const FILE_FIELDS = "id,name,mimeType,thumbnailLink,modifiedTime,size,webViewLink,parents,imageMediaMetadata(width,height,time,rotation,location(latitude,longitude)),videoMediaMetadata(width,height,durationMillis)";
  const LIST_FIELDS = "nextPageToken,files(" + FILE_FIELDS + ")";
  const PAGE = 160;            // tiles drawn at a time while scrolling
  const GAP = 4;
  const TYPE_KEY = { folder: "albums", image: "photos", video: "videos", doc: "docs" };
  const TYPES = ["all", "photos", "videos", "docs", "albums"];
  const SORTS = ["new", "old", "az", "za"];
  const GROUPS = ["auto", "day", "month", "year", "event", "place", "theme", "custom", "none"];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ic = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

  const S = {
    path: [ROOT], items: [], done: false, error: null, started: false, sig: "",
    type: "all", sort: store.get("dg-sort", "new"), date: "any", q: "", scope: "folder",
    group: store.get("dg-group", "auto"), gmap: null, geff: "none", gcount: new Map(), glabels: new Map(),
    layout: store.get("dg-layout", "mosaic"), size: +store.get("dg-size", 2) || 2,
    view: [], order: [], map: new Map(), counts: {}, sec: {}, multi: false,
    shown: 0, groups: new Map(), secs: {}, gen: 0,
    select: false, selected: new Map(),
    index: null, indexing: null, indexCount: 0, reelKey: "",
  };
  S.size = clamp(Math.round(S.size), 1, 3);
  if (!SORTS.includes(S.sort)) S.sort = "new";
  if (!GROUPS.includes(S.group)) S.group = "auto";
  const DEFAULT_GROUP = S.group;
  if (!["mosaic", "grid", "list"].includes(S.layout)) S.layout = "mosaic";
  const DEFAULT_SORT = S.sort;

  /* ---------- formatting ---------- */
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtDateLong = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const fmtMonth = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const fmtSize = (b) => { b = +b; if (!b) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(b < 10 && i ? 1 : 0) + " " + u[i]; };
  const fmtDur = (ms) => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); };
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3800); }

  /* ---------- file helpers ---------- */
  function taken(f) {
    let t = Date.parse(f.modifiedTime) || 0;
    const m = (f.imageMediaMetadata?.time || "").match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    if (m && +m[1] > 1990) { const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); if (!isNaN(d)) t = d; }
    return t;
  }
  function aspect(f) {
    const m = f.imageMediaMetadata || f.videoMediaMetadata;
    if (m && m.width && m.height) {
      let w = m.width, h = m.height;
      if (f.imageMediaMetadata && (m.rotation === 1 || m.rotation === 3)) [w, h] = [h, w];
      return clamp(w / h, 0.55, 2.2);
    }
    return f._k === "video" ? 16 / 9 : 1.5;
  }
  function prep(f) {
    f._k = f.mimeType === FOLDER ? "folder" : f.mimeType.startsWith("image/") ? "image" : f.mimeType.startsWith("video/") ? "video" : "doc";
    f._lc = f.name.toLowerCase();
    f._t = taken(f);
    f._ar = aspect(f);
    f._size = +f.size || 0;
    return f;
  }
  function docType(f) {
    const m = f.mimeType;
    if (m === "application/pdf") return "pdf";
    if (/spreadsheet|excel|csv/.test(m)) return "sheet";
    if (/presentation|powerpoint/.test(m)) return "slides";
    if (/document|word|text\//.test(m)) return "doc";
    return "file";
  }
  function docLabel(f) {
    const m = f.mimeType;
    if (m.includes("google-apps.document")) return "Doc";
    if (m.includes("google-apps.spreadsheet")) return "Sheet";
    if (m.includes("google-apps.presentation")) return "Slides";
    const parts = f.name.split(".");
    const e = parts.length > 1 ? parts.pop().toUpperCase() : "";
    return e && e.length <= 5 ? e : (m.split("/").pop() || "File").slice(0, 5);
  }
  const sized = (url, px) => url.replace(/=s\d+.*$/, "=s" + px);
  const driveThumb = (id, px) => `https://drive.google.com/thumbnail?id=${id}&sz=w${px}`;
  const thumbSrc = (f, px) => (f.thumbnailLink ? sized(f.thumbnailLink, px) : driveThumb(f.id, px));
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const bucket = (n) => [240, 360, 480, 640, 800, 1000, 1280].find((b) => b >= n) || 1280;

  const EXPORTS = {
    "application/vnd.google-apps.document": ["application/pdf", "pdf"],
    "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    "application/vnd.google-apps.presentation": ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
    "application/vnd.google-apps.drawing": ["image/png", "png"],
  };
  function downloadUrl(f) {
    if (f.mimeType.startsWith("application/vnd.google-apps.")) {
      const x = EXPORTS[f.mimeType];
      return x ? `${API}/files/${f.id}/export?mimeType=${encodeURIComponent(x[0])}&key=${CFG.API_KEY}` : (f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`);
    }
    return `https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t`;
  }
  async function downloadFiles(list) {
    if (!list.length) return;
    if (list.length > 1) toast(`Starting ${list.length} downloads. If your browser asks, allow multiple downloads.`);
    for (const f of list) {
      const a = el("a"); a.href = downloadUrl(f); a.target = "_blank"; a.rel = "noopener"; a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      if (list.length > 1) await sleep(700);
    }
  }

  /* ---------- Drive API ---------- */
  async function gget(path, params) {
    const url = API + path + "?" + new URLSearchParams({ ...params, key: CFG.API_KEY });
    let r, reason = "";
    for (let i = 0; i < 5; i++) {
      r = await fetch(url);
      if (!r.ok && r.status !== 404) {
        try { const j = await r.clone().json(); reason = j?.error?.errors?.[0]?.reason || j?.error?.status || ""; } catch { reason = ""; }
      }
      // Google reports "too many requests" as 403 as well as 429, so wait and retry
      const busy = r.status === 429 || r.status >= 500 || (r.status === 403 && /rateLimit|quota|backend/i.test(reason));
      if (busy && i < 4) { await sleep(600 * (i + 1) ** 2); continue; }
      break;
    }
    if (!r.ok) {
      const e = new Error(r.statusText); e.status = r.status; e.reason = reason;
      const why = reason ? ` (${reason})` : "";
      if (r.status === 400 && /key|API_KEY/i.test(reason)) e.message = "The Google API key isn't valid. Check the key in config.js.";
      else if (r.status === 400) e.message = `Google couldn't handle that request${why}. Try again.`;
      else if (r.status === 403 && /rateLimit|quota/i.test(reason)) e.message = "Google Drive is busy right now (too many requests). Wait a minute and try again.";
      else if (r.status === 403) e.message = `Google blocked this request${why}. Check that the folder is shared with “Anyone with the link” and that the API key allows this website.`;
      else if (r.status === 404) e.message = "This album can't be found. It may have been moved or unshared.";
      else e.message = "Couldn't reach Google Drive. Check your connection and try again.";
      throw e;
    }
    return r.json();
  }

  const known = new Map([[ROOT.id, { id: ROOT.id, name: ROOT.name, parent: null }]]);
  const folderCache = new Map();

  async function fetchFolder(id, gen, onProgress) {
    const c = folderCache.get(id);
    if (c) { onProgress(c, true); return c; }
    const items = []; let token = "";
    do {
      const data = await gget("/files", { q: `'${id}' in parents and trashed=false`, pageSize: 300, fields: LIST_FIELDS, pageToken: token });
      for (const f of data.files || []) { prep(f); items.push(f); if (f._k === "folder") known.set(f.id, { id: f.id, name: f.name, parent: id }); }
      token = data.nextPageToken || "";
      if (gen !== S.gen) return null;
      onProgress(items, !token);
    } while (token);
    folderCache.set(id, items);
    return items;
  }

  async function resolvePath(id) {
    const chain = []; let cur = id;
    for (let i = 0; i < 16; i++) {
      let info = known.get(cur);
      if (!info) {
        const f = await gget("/files/" + cur, { fields: "id,name,mimeType,parents" });
        if (f.mimeType !== FOLDER) throw new Error("not a folder");
        info = { id: f.id, name: f.name, parent: f.parents?.[0] || null };
        known.set(cur, info);
      }
      chain.unshift({ id: info.id, name: info.id === ROOT.id ? ROOT.name : info.name });
      if (cur === ROOT.id) return chain;
      if (!info.parent) throw new Error("outside");
      cur = info.parent;
    }
    throw new Error("too deep");
  }

  // Search everywhere: list every sub-folder once, then search the index in the browser.
  function ensureIndex() {
    if (S.index) return Promise.resolve(S.index);
    if (S.indexing) return S.indexing;
    S.indexing = (async () => {
      const all = []; const names = new Map([[ROOT.id, ROOT.name]]); const queue = [ROOT.id];
      const take = (data) => {
        for (const f of data.files || []) { prep(f); all.push(f); if (f._k === "folder") { queue.push(f.id); names.set(f.id, f.name); known.set(f.id, { id: f.id, name: f.name, parent: f.parents?.[0] || null }); } }
        S.indexCount = all.length; paintStatus();
      };
      const list = async (parents) => {
        const q = `(${parents.map((i) => `'${i}' in parents`).join(" or ")}) and trashed=false`;
        let token = "";
        do {
          const data = await gget("/files", { q, pageSize: 1000, fields: LIST_FIELDS, pageToken: token });
          take(data); token = data.nextPageToken || "";
        } while (token && all.length < 10000);
      };
      while (queue.length && all.length < 10000) {
        const batch = queue.splice(0, 10);
        try { await list(batch); }
        catch (e) {
          if (e.status !== 400 && e.status !== 403) throw e;
          // the combined query was refused: ask for the albums one at a time instead
          for (const id of batch) { await list([id]); await sleep(120); }
        }
      }
      S.index = { items: [...new Map(all.map((f) => [f.id, f])).values()], names };
      return S.index;
    })().then((x) => { render(); return x; }, (e) => { S.indexing = null; S.error = e.message; render(); });
    return S.indexing;
  }

  /* ---------- covers for album cards ---------- */
  const coverCache = new Map(); const coverQ = []; let coverBusy = 0;
  const coverIO = "IntersectionObserver" in window ? new IntersectionObserver((en) => {
    for (const x of en) if (x.isIntersecting) { coverIO.unobserve(x.target); loadCover(x.target); }
  }, { rootMargin: "300px" }) : null;
  function loadCover(a) {
    const id = a.dataset.id;
    if (coverCache.has(id)) { setCover(a, coverCache.get(id)); return; }
    coverQ.push(a); pumpCovers();
  }
  function pumpCovers() {
    while (coverBusy < 3 && coverQ.length) {
      const a = coverQ.shift(); if (!a.isConnected) continue;
      const id = a.dataset.id; coverBusy++;
      gget("/files", { q: `'${id}' in parents and trashed=false and mimeType contains 'image/'`, pageSize: 1, fields: "files(id,thumbnailLink)" })
        .then((d) => { const x = d.files?.[0]; return x ? (x.thumbnailLink ? sized(x.thumbnailLink, 640) : driveThumb(x.id, 640)) : null; })
        .catch(() => null)
        .then((u) => { coverCache.set(id, u); if (a.isConnected) setCover(a, u); })
        .finally(() => { coverBusy--; pumpCovers(); });
    }
  }
  function setCover(a, url) {
    if (!url) return;
    const cover = $(".cover", a); const img = new Image(); img.alt = ""; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    img.onload = () => img.classList.add("ok"); img.src = url; cover.prepend(img);
  }

  /* ---------- smart (visual) search ---------- */
  let aiSeq = 0;
  async function smartSearch(q, more = false) {
    const my = ++aiSeq; S.aiMore = more;
    if (!window.SmartSearch || q.length < 2) { S.ai = null; S.aiState = ""; return; }
    try {
      await new Promise((r) => setTimeout(r, 250)); if (my !== aiSeq) return; // wait for typing to settle
      if (!(await SmartSearch.available())) return;
      if (my !== aiSeq) return;
      S.aiState = "loading"; S.aiMsg = "Searching the photos…"; paintChrome();
      const scores = await SmartSearch.search(q, (m) => { if (my === aiSeq) { S.aiMsg = m; paintChrome(); } }, S.aiMore);
      if (my !== aiSeq) return;
      S.aiState = ""; S.ai = scores ? { q, scores } : null; render();
    } catch { if (my === aiSeq) { S.aiState = ""; S.ai = null; render(); } }
  }

  /* ---------- grouping ---------- */
  const DAY = 864e5, EVENT_GAP = 6 * 36e5;
  const groupData = { names: new Map(), asked: new Set(), themes: null, themesBusy: false, custom: null, customBusy: false, geoQ: [], geoBusy: false, timer: 0 };
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem("dg-places") || "{}"))) groupData.names.set(k, v); } catch { /* ignore */ }
  const effGroup = () => (S.ranked ? "none" : S.group === "auto" ? (S.sort === "new" || S.sort === "old" ? "month" : "none") : S.group);
  const dayStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const placeCell = (f) => { const l = f.imageMediaMetadata?.location; return l && isFinite(l.latitude) ? Math.round(l.latitude / 0.25) + "_" + Math.round(l.longitude / 0.25) : null; };

  function scheduleRender() { clearTimeout(groupData.timer); groupData.timer = setTimeout(() => render(), 250); }
  async function geocode() {
    if (groupData.geoBusy) return; groupData.geoBusy = true;
    while (groupData.geoQ.length) {
      const [cell, lat, lng] = groupData.geoQ.shift();
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
        const j = r.ok ? await r.json() : null;
        const name = j && (j.city || j.locality || j.principalSubdivision) ? [j.city || j.locality, j.principalSubdivision && j.principalSubdivision !== (j.city || j.locality) ? j.principalSubdivision : ""].filter(Boolean).join(", ") : "";
        if (name) groupData.names.set(cell, name);
      } catch { /* leave unnamed */ }
      if (!groupData.geoQ.length || groupData.geoQ.length % 6 === 0) { try { localStorage.setItem("dg-places", JSON.stringify(Object.fromEntries(groupData.names))); } catch { /* ignore */ } scheduleRender(); }
      await sleep(180);
    }
    groupData.geoBusy = false;
  }
  function ensureGroupData(g, me) {
    if (g === "place") {
      for (const f of me) { const c = placeCell(f); if (c && !groupData.names.has(c) && !groupData.asked.has(c)) { groupData.asked.add(c); const l = f.imageMediaMetadata.location; groupData.geoQ.push([c, l.latitude, l.longitude]); } }
      if (groupData.geoQ.length) geocode();
    } else if (g === "theme" && !groupData.themes && !groupData.themesBusy && window.SmartSearch) {
      groupData.themesBusy = true;
      SmartSearch.themes().then((m) => { groupData.themes = m || new Map(); }).catch(() => { groupData.themes = new Map(); }).finally(() => { groupData.themesBusy = false; scheduleRender(); });
    } else if (g === "custom" && !groupData.custom && !groupData.customBusy) {
      groupData.customBusy = true;
      fetch("groups.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => { groupData.custom = Array.isArray(j?.groups) ? j.groups : []; }).catch(() => { groupData.custom = []; }).finally(() => { groupData.customBusy = false; scheduleRender(); });
    }
  }
  function inFolder(id, anc) { for (let p = id, n = 0; p && n < 40; n++) { if (p === anc) return true; p = known.get(p)?.parent; } return false; }

  // Assigns every photo and video a group and puts the group's items next to each other.
  function groupMedia(me) {
    const g = effGroup(); S.geff = g; S.gmap = null; S.gcount = new Map(); S.glabels = new Map(); S.gnote = "";
    if (g === "none" || !me.length) return me;
    ensureGroupData(g, me);
    const dir = S.sort === "old" ? 1 : -1; // time-ordered groups follow the sort direction
    const A = new Map(); // id -> { k, l, o }
    const asg = (f, k, l, o) => A.set(f.id, { k, l, o });
    if (g === "day" || g === "month" || g === "year") {
      for (const f of me) {
        const d = new Date(f._t);
        if (g === "day") { const s = dayStart(f._t); asg(f, "d" + s, fmtDay(f._t), dir * s); }
        else if (g === "month") { const s = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); asg(f, "m" + s, fmtMonth(f._t), dir * s); }
        else { const s = new Date(d.getFullYear(), 0, 1).getTime(); asg(f, "y" + s, String(d.getFullYear()), dir * s); }
      }
    } else if (g === "event") {
      const byT = [...me].sort((a, b) => a._t - b._t); let cl = [], last = 0;
      const close = () => {
        if (!cl.length) return; const a = cl[0]._t, b = cl.at(-1)._t, da = dayStart(a), db = dayStart(b);
        const label = da === db ? fmtDay(a) : `${new Date(a).toLocaleDateString(undefined, { day: "numeric", month: "short" })} to ${new Date(b).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
        for (const f of cl) asg(f, "e" + a, label, dir * a); cl = [];
      };
      for (const f of byT) { if (cl.length && f._t - last > EVENT_GAP) close(); cl.push(f); last = f._t; } close();
      S.gnote = "Events are photos taken within a few hours of each other.";
    } else if (g === "place") {
      let any = false;
      for (const f of me) {
        const c = placeCell(f);
        if (!c) { asg(f, "none", "No location", Infinity); continue; }
        any = true; const n = groupData.names.get(c);
        asg(f, n ? "n:" + n : "c:" + c, n || "Finding place name…", 0);
      }
      if (!any) S.gnote = "None of these photos carry location data.";
    } else if (g === "theme") {
      if (!groupData.themes) { for (const f of me) asg(f, "load", "Working out themes…", 0); }
      else {
        for (const f of me) { const t = groupData.themes.get(f.id); asg(f, t ? "t:" + t : "other", t || "Other", 0); }
        if (!groupData.themes.size) S.gnote = "Themes appear once the photo index is built (it updates every night).";
      }
    } else if (g === "custom") {
      const rules = groupData.custom;
      if (!rules) { for (const f of me) asg(f, "load", "Loading your groups…", 0); }
      else {
        for (const f of me) {
          const i = rules.findIndex((r) => (r.files || []).includes(f.id) || (r.folders || []).some((d) => f.parents?.some((p) => inFolder(p, d))) || (r.match || []).some((m) => f._lc.includes(String(m).toLowerCase())));
          if (i >= 0) asg(f, "g" + i, rules[i].name || "Group " + (i + 1), i); else asg(f, "rest", "Everything else", Infinity);
        }
        if (!rules.length) S.gnote = "No custom groups yet. Add them in groups.json (see the README).";
      }
    }
    const buckets = new Map();
    for (const f of me) { const a = A.get(f.id); let b = buckets.get(a.k); if (!b) buckets.set(a.k, (b = { ...a, items: [] })); b.items.push(f); }
    let list = [...buckets.values()];
    if (g === "place" || g === "theme") list.sort((x, y) => (x.o === Infinity) - (y.o === Infinity) || (x.k === "other") - (y.k === "other") || y.items.length - x.items.length || coll.compare(x.l, y.l));
    else list.sort((x, y) => (x.o === Infinity) - (y.o === Infinity) || x.o - y.o);
    S.gmap = new Map(); const out = [];
    for (const b of list) { S.gcount.set(b.k, b.items.length); S.glabels.set(b.k, b.l); for (const f of b.items) { S.gmap.set(f.id, b.k); out.push(f); } }
    return out;
  }

  /* ---------- filtering ---------- */
  function baseList() { return S.q && S.scope === "all" ? (S.index ? S.index.items : []) : S.items; }
  function dateRange() {
    const d = S.date, now = Date.now();
    if (d === "7") return [now - 7 * 864e5, Infinity];
    if (d === "30") return [now - 30 * 864e5, Infinity];
    if (d === "365") return [now - 365 * 864e5, Infinity];
    if (/^y\d{4}$/.test(d)) { const y = +d.slice(1); return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]; }
    return null;
  }
  function searchText(f) {
    // Lets people search by date too, for example "september" or "2026".
    return f._lc + " " + new Date(f._t).toLocaleDateString("en", { month: "long", year: "numeric" }).toLowerCase();
  }
  function compute() {
    const terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    const range = dateRange();
    const counts = { all: 0, photos: 0, videos: 0, docs: 0, albums: 0 };
    const out = []; const base = baseList();
    const ai = terms.length && S.ai && S.ai.q === S.q && S.ai.scores.size ? S.ai.scores : null;
    S.map = new Map(); S.aiHits = 0;
    for (const f of base) {
      S.map.set(f.id, f);
      if (terms.length) {
        const hay = searchText(f), byName = terms.every((t) => hay.includes(t));
        if (!byName && !(ai && f._k === "image" && ai.has(f.id))) continue;
        if (ai) { f._rank = byName ? 2 + (ai.get(f.id) || 0) : ai.get(f.id); if (!byName) S.aiHits++; }
      }
      if (range && (f._t < range[0] || f._t >= range[1])) continue;
      counts.all++; counts[TYPE_KEY[f._k]]++;
      if (S.type !== "all" && TYPE_KEY[f._k] !== S.type) continue;
      out.push(f);
    }
    const cmp = {
      new: (a, b) => b._t - a._t || coll.compare(a.name, b.name),
      old: (a, b) => a._t - b._t || coll.compare(a.name, b.name),
      az: (a, b) => coll.compare(a.name, b.name),
      za: (a, b) => coll.compare(b.name, a.name),
    }[S.sort];
    out.sort(ai ? (a, b) => (b._rank || 0) - (a._rank || 0) || cmp(a, b) : cmp);
    S.ranked = !!ai;
    const fo = [], me0 = [], dc = [];
    for (const f of out) (f._k === "folder" ? fo : f._k === "doc" ? dc : me0).push(f);
    const me = groupMedia(me0);
    S.view = out; S.order = [...fo, ...me, ...dc];
    S.sec = { folder: fo.length, media: me.length, doc: dc.length };
    S.multi = (fo.length > 0) + (me.length > 0) + (dc.length > 0) > 1;
    S.counts = counts;
    S.mediaTitle = me.length && me.every((f) => f._k === "image") ? "Photos" : me.length && me.every((f) => f._k === "video") ? "Videos" : "Photos and videos";
  }

  /* ---------- rendering ---------- */
  let renderTimer = 0;
  function scheduleRender(ms = 220) { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; render(); }, ms); }

  function render() {
    clearTimeout(renderTimer); renderTimer = 0;
    compute(); paintChrome();
    const c = $("#content");
    const keep = S.shown;
    c.textContent = ""; S.secs = {}; S.groups = new Map(); S.shown = 0;
    c.className = "content layout-" + S.layout + (S.multi || S.q ? "" : " no-heads");
    applySizes();
    paintStatus();
    if (S.gnote && S.sec.media) { const n = el("p", "gnote"); n.textContent = S.gnote; c.append(n); }
    if (!S.order.length) return;
    appendMore(Math.max(PAGE, keep));
    watchSentinel();
  }

  function applySizes() {
    const w = innerWidth, c = $("#content");
    const tile = w < 640 ? [100, 128, 168] : w < 1024 ? [130, 168, 216] : [150, 196, 256];
    c.style.setProperty("--tile", tile[S.size - 1] + "px");
    c.style.setProperty("--album", (w < 640 ? [150, 170, 230] : [190, 230, 300])[S.size - 1] + "px");
  }
  function targetH() { const w = innerWidth; return (w < 640 ? [84, 108, 140] : w < 1024 ? [120, 156, 204] : [150, 200, 264])[S.size - 1]; }

  function section(name, title, count) {
    let s = S.secs[name]; if (s) return s;
    const e = el("section", "sec sec-" + name);
    e.innerHTML = `<div class="sec-h"><h2>${esc(title)}</h2><span class="c">${count.toLocaleString()}</span></div><div class="sec-body"></div>`;
    $("#content").append(e);
    return (S.secs[name] = { el: e, body: $(".sec-body", e) });
  }

  function appendMore(n) {
    const end = Math.min(S.order.length, S.shown + n);
    const touched = new Set();
    for (let i = S.shown; i < end; i++) place(S.order[i], touched);
    S.shown = end;
    if (S.layout === "mosaic") for (const g of touched) layoutGroup(g);
  }

  function place(f, touched) {
    if (f._k === "folder") {
      const s = section("albums", "Albums", S.sec.folder); s.body.classList.add("albums");
      s.body.append(albumEl(f)); return;
    }
    if (f._k === "doc") {
      const s = section("docs", "Documents", S.sec.doc); s.body.classList.add("rows");
      s.body.append(tileEl(f)); return;
    }
    const s = section("media", S.mediaTitle, S.sec.media);
    const key = S.gmap ? S.gmap.get(f.id) : "all";
    let g = S.groups.get(key);
    if (!g) {
      const e = el("div", "grp " + S.layout);
      if (S.gmap) { const h = el("h3", "grp-h"); h.append(S.glabels.get(key) || ""); const n = el("span", "gn"); n.textContent = (S.gcount.get(key) || 0).toLocaleString(); h.append(n); e.append(h); }
      const body = el("div", "grp-body" + (S.layout === "list" ? " rows" : "")); e.append(body);
      s.body.append(e); g = { el: e, body, tiles: [] }; S.groups.set(key, g);
    }
    const t = tileEl(f);
    g.tiles.push({ el: t, ar: f._ar });
    if (S.layout === "mosaic") touched.add(g); else g.body.append(t);
  }

  function layoutGroup(g) {
    const W = g.body.clientWidth; if (!W) return;
    const H = targetH();
    g.body.textContent = "";
    let row = [], sum = 0;
    const flush = (items, s, full) => {
      const n = items.length, h = full ? (W - GAP * (n - 1)) / s : H;
      const r = el("div", "row"); r.style.height = h.toFixed(2) + "px";
      if (!full) r.style.maxWidth = (s * H + GAP * (n - 1)).toFixed(1) + "px";
      for (const t of items) r.append(t.el);
      g.body.append(r);
    };
    for (const t of g.tiles) {
      row.push(t); sum += t.ar;
      if (sum * H + GAP * (row.length - 1) >= W) { flush(row, sum, true); row = []; sum = 0; }
    }
    if (row.length) flush(row, sum, false);
  }

  function subline(f) {
    const parts = [fmtDate(f._t)];
    if (f._size && (f._k === "doc" || S.layout === "list")) parts.push(fmtSize(f._size));
    if (S.q && S.scope === "all") {
      const p = f.parents?.[0], n = S.index?.names.get(p);
      if (n && p !== ROOT.id) parts.push("In " + n);
    }
    return parts;
  }

  function tileEl(f) {
    const k = f._k, t = el("div", `tile k-${k}` + (k === "doc" ? " t-" + docType(f) : ""));
    t.dataset.id = f.id; t.tabIndex = 0; t.setAttribute("role", "button");
    t.setAttribute("aria-label", f.name + (k === "video" ? ", video" : ""));
    t.style.setProperty("--ar", f._ar.toFixed(3));
    if (S.selected.has(f.id)) t.classList.add("sel");
    const th = el("div", "thumb");
    const rows = k === "doc" || S.layout === "list";
    const px = rows ? 160 : bucket(Math.max(targetH() * f._ar, targetH()) * dpr() * 1.15);
    const img = new Image(); img.alt = ""; img.decoding = "async"; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    let tries = 0;
    img.onload = () => img.classList.add("ok");
    img.onerror = () => { if (tries++ === 0) img.src = driveThumb(f.id, px); else img.remove(); };
    img.src = thumbSrc(f, px);
    th.append(img); th.insertAdjacentHTML("beforeend", `<span class="ph">${ic(k === "doc" ? "file" : k)}</span>`);
    t.append(th);
    let extra = "";
    if (k === "video") {
      extra += `<span class="play">${ic("play")}</span>`;
      const d = f.videoMediaMetadata?.durationMillis; if (d) extra += `<span class="dur">${fmtDur(+d)}</span>`;
    }
    if (k === "doc") extra += `<span class="badge">${esc(docLabel(f))}</span>`;
    extra += `<button class="chk" type="button" tabindex="-1" aria-label="Select ${esc(f.name)}">${ic("check")}</button>`;
    extra += `<button class="dl" type="button" tabindex="-1" aria-label="Download ${esc(f.name)}">${ic("download")}</button>`;
    extra += `<div class="meta"><div class="nm">${esc(f.name)}</div><div class="sb">${subline(f).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
    t.insertAdjacentHTML("beforeend", extra);
    return t;
  }

  function albumEl(f) {
    const a = el("div", "album"); a.dataset.id = f.id; a.tabIndex = 0; a.setAttribute("role", "button");
    a.setAttribute("aria-label", "Open album " + f.name);
    a.innerHTML = `<div class="cover"><span class="ph">${ic("folder")}</span></div><div class="cap"><strong>${esc(f.name)}</strong><small>${esc(fmtDate(f._t))}</small></div>`;
    if (coverIO) coverIO.observe(a); else loadCover(a);
    return a;
  }

  let sentinelIO;
  function watchSentinel() {
    const s = $("#sentinel");
    if (!sentinelIO) sentinelIO = new IntersectionObserver((en) => {
      if (en[0].isIntersecting && S.shown < S.order.length) { appendMore(PAGE); sentinelIO.unobserve(s); sentinelIO.observe(s); }
    }, { rootMargin: "1400px" });
    sentinelIO.unobserve(s); sentinelIO.observe(s);
  }

  /* ---------- hero, tabs, tags, status ---------- */
  function paintChrome() {
    const cur = S.path.at(-1), searching = !!S.q, filtering = S.date !== "any";
    $("#title").textContent = cur.name;
    document.title = cur.id === ROOT.id ? ROOT.name : `${cur.name} – ${ROOT.name}`;
    $("#hero").classList.toggle("compact", searching || filtering);
    $("#lede").textContent = cur.id === ROOT.id ? (CFG.TAGLINE || "Photos, videos and documents.") : "";
    // breadcrumbs
    const cr = $("#crumbs");
    if (S.path.length > 1) {
      cr.hidden = false; cr.textContent = "";
      S.path.slice(0, -1).forEach((p, i) => {
        const b = el("button"); b.type = "button"; b.textContent = p.name; b.dataset.i = i; cr.append(b);
        cr.insertAdjacentHTML("beforeend", ic("chevron"));
      });
    } else cr.hidden = true;
    // stats
    const all = S.items; const c = { folder: 0, image: 0, video: 0, doc: 0 };
    for (const f of all) c[f._k]++;
    let text;
    if (searching) text = S.aiState === "loading" ? (S.aiMsg || "Preparing smart search…") : `${plural(S.view.length, "result")} for “${S.q}” ${S.scope === "all" ? "in every album" : "in this album"}${S.aiHits ? `, ${plural(S.aiHits, "photo")} matched by what is in them` : ""}`;
    else {
      const parts = [];
      if (c.folder) parts.push(plural(c.folder, "album")); if (c.image) parts.push(plural(c.image, "photo"));
      if (c.video) parts.push(plural(c.video, "video")); if (c.doc) parts.push(plural(c.doc, "document"));
      text = parts.join(", ") + (S.done ? "" : (parts.length ? ", " : "") + "loading more");
      if (S.done && !parts.length) text = "";
    }
    $("#stats").textContent = text;
    if (searching && S.ai && S.ai.q === S.q && S.aiState !== "loading") {
      const b = el("button", "linkbtn"); b.type = "button";
      b.textContent = S.aiMore ? "Show fewer, closer matches" : "Show more matches";
      b.onclick = () => smartSearch(S.q, !S.aiMore);
      $("#stats").append(" ", b);
    }
    // tabs
    for (const b of $$("#tabs .tab")) {
      const t = b.dataset.type, n = S.counts[t] ?? 0;
      b.setAttribute("aria-pressed", String(S.type === t));
      $(".n", b).textContent = n ? n.toLocaleString() : "";
      b.hidden = t !== "all" && n === 0 && S.type !== t;
    }
    // active filters
    const tags = $("#tags"); tags.textContent = "";
    const addTag = (label, fn) => { const b = el("button", "tag"); b.type = "button"; b.innerHTML = `${esc(label)}${ic("x")}`; b.setAttribute("aria-label", "Remove filter: " + label); b.onclick = fn; tags.append(b); };
    if (filtering) addTag(dateLabel(S.date), () => { S.date = "any"; changed(); });
    if (S.type !== "all" && (searching || filtering)) addTag(tabLabel(S.type), () => { S.type = "all"; changed(); });
    if (tags.children.length) { const b = el("button", "tag clear-all"); b.type = "button"; b.textContent = "Clear all"; b.onclick = clearFilters; tags.append(b); }
    $("#scope").hidden = !searching;
    for (const b of $$("#scope button")) b.setAttribute("aria-pressed", String(b.dataset.scope === S.scope));
    $("#active-row").hidden = !searching && !tags.children.length;
    $("#filters-dot").hidden = S.date === "any" && S.sort === DEFAULT_SORT && S.group === DEFAULT_GROUP;
    $("#btn-slideshow").hidden = !S.order.some((f) => f._k === "image");
    $("#search-clear").hidden = !$("#search").value;
    paintReel();
  }
  const tabLabel = (t) => ({ photos: "Photos", videos: "Videos", docs: "Documents", albums: "Albums" }[t] || "All");
  function dateLabel(d) { return d === "7" ? "Last 7 days" : d === "30" ? "Last 30 days" : d === "365" ? "Last 12 months" : /^y\d{4}$/.test(d) ? d.slice(1) : "Any time"; }

  function paintReel() {
    const r = $("#reel");
    const imgs = (!S.q && S.date === "any" && S.type === "all") ? S.items.filter((f) => f._k === "image").sort((a, b) => b._t - a._t).slice(0, 8) : [];
    const key = imgs.map((f) => f.id).join(",");
    if (!imgs.length) { r.hidden = true; S.reelKey = ""; return; }
    r.hidden = false;
    if (key === S.reelKey) return;
    S.reelKey = key; r.textContent = ""; r.classList.remove("in");
    imgs.forEach((f, i) => {
      const b = el("button", "frame"); b.type = "button"; b.dataset.id = f.id; b.style.setProperty("--i", i);
      b.setAttribute("aria-label", "Open " + f.name);
      const im = new Image(); im.alt = ""; im.decoding = "async"; im.referrerPolicy = "no-referrer";
      let tr = 0; im.onerror = () => { if (tr++ === 0) im.src = driveThumb(f.id, 400); };
      im.src = thumbSrc(f, 400); b.append(im); r.append(b);
    });
    requestAnimationFrame(() => r.classList.add("in"));
  }

  function paintStatus() {
    const st = $("#status");
    let html = "";
    if (S.error) html = `<p>${esc(S.error)}</p><button class="btn" type="button" id="retry">Try again</button>`;
    else if (S.q && S.scope === "all" && !S.index) html = `<p>Searching every album${S.indexCount ? `, ${S.indexCount.toLocaleString()} files so far` : ""}…</p>`;
    else if (!S.started || (!S.done && !S.items.length)) { st.hidden = true; $("#content").innerHTML = `<div class="skel" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<i style="width:${[180, 140, 220, 160, 200, 120][i % 6]}px"></i>`).join("")}</div>`; return; }
    else if (!S.order.length) {
      const filtered = S.q || S.date !== "any" || S.type !== "all";
      html = `<div class="empty">${ic("image")}<h2>${filtered ? "Nothing matches" : "This album is empty"}</h2><p>${filtered ? "Try a different word, or search every album instead." : "Photos, videos and documents added to this folder in Google Drive will show up here."}</p>${filtered ? `<button class="btn" type="button" id="clear-btn">Clear search and filters</button>` : ""}</div>`;
    }
    st.innerHTML = html; st.hidden = !html;
  }

  /* ---------- URL state ---------- */
  const normHash = () => {
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    const t = p.get("t"), s = p.get("s");
    return { d: p.get("d") || ROOT.id, t: TYPES.includes(t) ? t : "all", q: (p.get("q") || "").slice(0, 120), s: SORTS.includes(s) ? s : DEFAULT_SORT, g: GROUPS.includes(p.get("g")) ? p.get("g") : DEFAULT_GROUP, r: p.get("r") || "any", scope: p.get("in") === "all" ? "all" : "folder", f: p.get("f") };
  };
  const curSig = () => [S.path.at(-1).id, S.type, S.q, S.sort, S.group, S.date, S.q && S.scope === "all" ? "all" : "folder"].join("|");
  function hashFor(o = {}) {
    const p = new URLSearchParams(); const d = o.d ?? S.path.at(-1).id;
    if (d !== ROOT.id) p.set("d", d);
    if (S.type !== "all") p.set("t", S.type);
    if (S.q) p.set("q", S.q);
    if (S.sort !== DEFAULT_SORT) p.set("s", S.sort);
    if (S.group !== DEFAULT_GROUP) p.set("g", S.group);
    if (S.date !== "any") p.set("r", S.date);
    if (S.q && S.scope === "all") p.set("in", "all");
    if (o.f) p.set("f", o.f);
    const s = p.toString();
    return s ? "#" + s : location.pathname + location.search;
  }
  function syncUrl() { S.sig = curSig(); history.replaceState(null, "", hashFor(V.el.hidden ? {} : { f: V.list[V.idx]?.id })); }
  function changed() { syncUrl(); render(); }
  function clearFilters() { S.q = ""; S.date = "any"; S.type = "all"; $("#search").value = ""; changed(); }

  async function applyHash() {
    const h = normHash();
    const sig = [h.d, h.t, h.q, h.s, h.g, h.r, h.q && h.scope === "all" ? "all" : "folder"].join("|");
    if (sig !== S.sig || !S.started) {
      const newFolder = h.d !== S.path.at(-1).id || !S.started;
      S.sig = sig; S.type = h.t; S.q = h.q; S.sort = h.s; S.group = h.g; S.date = /^(any|7|30|365|y\d{4})$/.test(h.r) ? h.r : "any"; S.scope = h.scope;
      $("#search").value = S.q;
      if (newFolder) await loadFolder(h.d); else render();
      S.started = true; smartSearch(S.q);
      if (S.q && S.scope === "all") ensureIndex();
    }
    if (h.f) await openFromHash(h.f); else closeViewer(true);
  }

  async function loadFolder(id) {
    const gen = ++S.gen;
    S.error = null; S.items = []; S.done = false; S.shown = 0; S.started = true; S.reelKey = "";
    let path;
    try { path = await resolvePath(id); }
    catch { if (id !== ROOT.id) { toast("That link isn't available. Showing the main album."); history.replaceState(null, "", location.pathname + location.search); } id = ROOT.id; path = [ROOT]; S.sig = ""; }
    if (gen !== S.gen) return;
    S.path = path; S.sig = curSig();
    render();
    await new Promise((resolve) => {
      let first = true;
      fetchFolder(id, gen, (items, done) => {
        if (gen !== S.gen) return;
        S.items = items; S.done = done;
        if (first) { first = false; render(); resolve(); } else if (done) render(); else scheduleRender(350);
      }).catch((e) => { if (gen === S.gen) { S.error = e.message; S.done = true; render(); } resolve(); });
    });
  }

  function navigateTo(id) {
    S.q = ""; S.type = "all"; S.date = "any"; $("#search").value = "";
    history.pushState(null, "", hashFor({ d: id }));
    window.scrollTo({ top: 0 });
    return applyHash();
  }

  /* ---------- sharing ---------- */
  const baseUrl = () => location.origin + location.pathname;
  function fileUrl(f) { const par = f.parents?.[0] || S.path.at(-1).id; return baseUrl() + "#" + new URLSearchParams({ ...(par !== ROOT.id ? { d: par } : {}), f: f.id }).toString(); }
  function folderUrl(id) { return id === ROOT.id ? baseUrl() : baseUrl() + "#d=" + id; }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    const ta = el("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { /* ignore */ } ta.remove(); return ok;
  }
  async function shareLink(url, title) {
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    toast((await copyText(url)) ? "Link copied" : "Couldn't copy the link. Copy it from the address bar.");
  }

  /* ---------- selection ---------- */
  function updateSel() {
    document.body.classList.toggle("selecting", S.select);
    $("#selbar").hidden = !S.select;
    const n = S.selected.size;
    $("#sel-count").textContent = n ? `${n.toLocaleString()} selected` : "Select files";
    $("#sel-dl").disabled = $("#sel-link").disabled = !n;
    $("#sel-dl").style.opacity = $("#sel-link").style.opacity = n ? "" : ".5";
    $("#btn-select").setAttribute("aria-pressed", String(S.select));
  }
  function toggleSel(f, node) {
    if (S.selected.has(f.id)) S.selected.delete(f.id); else S.selected.set(f.id, f);
    S.select = true;
    (node || $(`[data-id="${CSS.escape(f.id)}"]`))?.classList.toggle("sel", S.selected.has(f.id));
    updateSel();
  }
  function endSelect() { S.select = false; S.selected.clear(); $$(".tile.sel").forEach((t) => t.classList.remove("sel")); updateSel(); }

  /* ---------- viewer ---------- */
  const V = { el: $("#viewer"), idx: -1, list: [], pushed: false, play: null, img: null, vid: null, mode: "", Z: { s: 1, x: 0, y: 0 }, fit: { w: 0, h: 0, cx: 0, cy: 0 }, nat: { w: 0, h: 0 }, maxS: 6, big: false, opener: null, idle: 0, info: false, cleanup: null };
  const stage = $("#v-stage");
  const inertEls = () => [$("#bar"), $("#page"), $("#selbar")];
  const mediaUrl = (f) => `${API}/files/${f.id}?alt=media&key=${CFG.API_KEY}`;
  const driveView = (f) => f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;

  function openById(id) {
    const list = S.order.filter((f) => f._k !== "folder");
    let i = list.findIndex((f) => f.id === id);
    if (i < 0) { const f = S.map.get(id); if (!f) return; showViewer([f], 0); return; }
    showViewer(list, i);
  }

  function showViewer(list, i, { push = true } = {}) {
    V.list = list;
    if (V.el.hidden) {
      V.opener = document.activeElement; V.el.hidden = false; document.body.classList.add("lock");
      inertEls().forEach((e) => (e.inert = true));
      V.pushed = false;
      if (push) { history.pushState(null, "", hashFor({ f: list[i].id })); V.pushed = true; }
      $("#v-close").focus({ preventScroll: true });
    }
    go(i);
  }

  function teardown() {
    if (V.vid) { try { V.vid.pause(); V.vid.removeAttribute("src"); V.vid.load(); } catch { /* ignore */ } }
    V.cleanup?.(); V.cleanup = null; V.vid = null; V.img = null;
    stage.textContent = ""; stage.className = "v-stage";
  }

  function closeViewer(fromPop) {
    if (V.el.hidden) return;
    closeEditor(); stopPlay(); V.el.hidden = true; document.body.classList.remove("lock");
    inertEls().forEach((e) => (e.inert = false));
    teardown(); $("#v-panel").hidden = true; V.info = false; $("#v-info").setAttribute("aria-pressed", "false");
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    clearTimeout(V.idle);
    if (!fromPop) { if (V.pushed) { V.pushed = false; history.back(); } else history.replaceState(null, "", hashFor()); }
    V.opener?.focus?.({ preventScroll: true });
  }

  function setMode(mode) {
    V.mode = mode;
    V.el.classList.toggle("img", mode === "img"); V.el.classList.toggle("vid", mode === "vid"); V.el.classList.toggle("frame", mode === "frame");
    V.el.classList.remove("idle");
  }

  function go(i) {
    i = clamp(i, 0, V.list.length - 1); V.idx = i;
    const f = V.list[i];
    teardown(); V.Z = { s: 1, x: 0, y: 0 }; V.big = false;
    setMode(f._k === "image" ? "img" : f._k === "video" ? "vid" : "frame");
    if (V.mode === "img") mountImage(f, i); else if (V.mode === "vid") mountVideo(f); else mountFrame(f);
    $("#v-name").textContent = f.name;
    $("#v-sub").textContent = `${i + 1} of ${V.list.length}, ${fmtDate(f._t)}`;
    $("#v-prev").hidden = i === 0; $("#v-next").hidden = i === V.list.length - 1;
    $("#v-edit").hidden = !(EDIT.api && f._k === "image");
    paintStrip(); if (V.info) paintInfo(f);
    if (location.hash !== hashFor({ f: f.id }) && !V.el.hidden) history.replaceState(null, "", hashFor({ f: f.id }));
    wake();
  }

  /* ----- photos: fit to screen, zoom, pan ----- */
  function mountImage(f, i) {
    const img = new Image(); img.className = "v-img"; img.alt = f.name; img.draggable = false; img.referrerPolicy = "no-referrer";
    const m = f.imageMediaMetadata; let nw = m?.width || 0, nh = m?.height || 0;
    if (m && (m.rotation === 1 || m.rotation === 3)) [nw, nh] = [nh, nw];
    V.nat = { w: nw, h: nh }; V.img = img;
    const spin = el("div", "v-spin"); stage.append(spin, img);
    let step = 0;
    img.onload = () => { spin.remove(); fitImage(); };
    img.onerror = () => {
      step++;
      if (step === 1) img.src = driveThumb(f.id, 2000);
      else if (step === 2) img.src = mediaUrl(f);
      else { spin.remove(); toast("This photo couldn't be loaded. Try Open in Drive from the details panel."); }
    };
    img.src = thumbSrc(f, 800);
    const hi = new Image(); hi.referrerPolicy = "no-referrer";
    hi.onload = () => { if (V.idx === i && V.img === img) img.src = hi.src; };
    hi.src = thumbSrc(f, 2400);
    for (const j of [i + 1, i - 1]) { const n = V.list[j]; if (n && n._k === "image") new Image().src = thumbSrc(n, 1600); }
    fitImage(); paintZoom();
  }

  // Size the photo to fit inside the visible area, whatever its shape or the screen's shape.
  function fitImage() {
    const im = V.img; if (!im) return;
    const SW = stage.clientWidth, SH = stage.clientHeight; if (!SW || !SH) return;
    const ar = im.naturalWidth ? im.naturalWidth / im.naturalHeight : V.nat.w ? V.nat.w / V.nat.h : 0;
    if (!ar) return;
    const wide = SW >= 900, padT = wide ? 60 : 0, padB = wide ? 88 : 0, padX = wide ? 70 : 0;
    const aw = Math.max(80, SW - 2 * padX), ah = Math.max(80, SH - padT - padB);
    let w, h; if (aw / ah < ar) { w = aw; h = aw / ar; } else { h = ah; w = ah * ar; }
    if (V.nat.w && w > V.nat.w * 2) { const k = (V.nat.w * 2) / w; w *= k; h *= k; } // never blow small photos up past 2x
    w = Math.round(w); h = Math.round(h);
    const left = Math.round((SW - w) / 2), top = Math.round(padT + (ah - h) / 2);
    Object.assign(im.style, { width: w + "px", height: h + "px", left: left + "px", top: top + "px", visibility: "visible" });
    V.fit = { w, h, cx: left + w / 2, cy: top + h / 2 };
    V.maxS = clamp(V.nat.w ? (V.nat.w * 2) / w : 6, 4, 14);
    clampPan(); applyZ();
  }

  function paintZoom() {
    const z = V.Z.s, b = $("#v-zreset");
    b.textContent = z < 1.02 ? "Fit" : Math.round(z * 100) + "%";
    b.setAttribute("aria-label", z < 1.02 ? "Zoom to actual size" : "Fit to screen"); b.title = z < 1.02 ? "Actual size (0)" : "Fit to screen (0)";
    $("#v-zout").disabled = z < 1.02; $("#v-zin").disabled = z > V.maxS - 0.01;
  }
  function applyZ() {
    const im = V.img; if (!im) return;
    im.style.transform = `translate(${V.Z.x}px,${V.Z.y}px) scale(${V.Z.s})`;
    stage.classList.toggle("zoomed", V.Z.s > 1.02); paintZoom();
    if (V.Z.s > 1.4 && !V.big) { // sharper pixels once the person zooms in
      V.big = true; const f = V.list[V.idx], idx = V.idx, hi = new Image(); hi.referrerPolicy = "no-referrer";
      hi.onload = () => { if (V.idx === idx && V.img === im) im.src = hi.src; };
      hi.src = thumbSrc(f, 4096);
    }
  }
  function clampPan() {
    const Z = V.Z, { w, h, cx, cy } = V.fit; if (!V.img || !w) return;
    const SW = stage.clientWidth, SH = stage.clientHeight, sw = w * Z.s, sh = h * Z.s;
    Z.x = sw > SW ? clamp(Z.x, SW - sw / 2 - cx, sw / 2 - cx) : 0;
    Z.y = sh > SH ? clamp(Z.y, SH - sh / 2 - cy, sh / 2 - cy) : 0;
  }
  // (px, py) is the point, relative to the photo's centre, that stays put while zooming
  function zoomTo(s, px, py) {
    if (!V.img || !V.fit.w) return;
    const Z = V.Z; s = clamp(s, 1, V.maxS); const k = s / Z.s;
    Z.x = px - (px - Z.x) * k; Z.y = py - (py - Z.y) * k; Z.s = s;
    if (s <= 1.001) { Z.s = 1; Z.x = 0; Z.y = 0; } else clampPan();
    applyZ();
  }
  const mid = () => [stage.clientWidth / 2 - V.fit.cx, stage.clientHeight / 2 - V.fit.cy];
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - V.fit.cx, e.clientY - r.top - V.fit.cy]; };
  const zoomBy = (k) => { const [px, py] = mid(); zoomTo(k > 1 && V.Z.s < 1.02 ? Math.max(1.5, V.Z.s * k) : V.Z.s * k, px, py); if (V.Z.s < 1.06) zoomTo(1, 0, 0); };
  function zoomToggle(px, py) { zoomTo(V.Z.s > 1.02 ? 1 : 2.6, px, py); }
  function zoomReset() { if (V.Z.s > 1.02) zoomTo(1, 0, 0); else { const [px, py] = mid(); zoomTo(V.nat.w ? Math.max(2, V.nat.w / V.fit.w) : 2.6, px, py); } }
  function panBy(dx, dy) { V.Z.x += dx; V.Z.y += dy; clampPan(); applyZ(); }

  const ptrs = new Map(); let gest = null, lastTap = null, lastType = "mouse", tapTimer = 0, wheelT = 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  stage.addEventListener("pointerdown", (e) => {
    lastType = e.pointerType; if (!V.img) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) gest = { x0: e.clientX, y0: e.clientY, t0: Date.now(), zx: V.Z.x, zy: V.Z.y, moved: false };
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect();
      gest = { pinch: true, d0: Math.max(1, dist(a, b)), s0: V.Z.s, zx: V.Z.x, zy: V.Z.y, px: (a.x + b.x) / 2 - r.left - V.fit.cx, py: (a.y + b.y) / 2 - r.top - V.fit.cy };
      stage.classList.add("dragging");
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId) || !gest) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gest.pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect();
      const s = clamp(gest.s0 * dist(a, b) / gest.d0, 1, V.maxS), k = s / gest.s0;
      const px = (a.x + b.x) / 2 - r.left - V.fit.cx, py = (a.y + b.y) / 2 - r.top - V.fit.cy; // fingers may also drag while pinching
      V.Z.s = s; V.Z.x = px - (gest.px - gest.zx) * k; V.Z.y = py - (gest.py - gest.zy) * k;
      if (s <= 1.001) { V.Z.x = 0; V.Z.y = 0; } else clampPan();
      applyZ(); return;
    }
    const dx = e.clientX - gest.x0, dy = e.clientY - gest.y0;
    if (Math.abs(dx) + Math.abs(dy) > 8) gest.moved = true;
    if (V.Z.s > 1.02 && gest.moved) { stage.classList.add("dragging"); V.Z.x = gest.zx + dx; V.Z.y = gest.zy + dy; clampPan(); applyZ(); }
  });
  const endPtr = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const g = gest, was = ptrs.size; ptrs.delete(e.pointerId);
    stage.classList.remove("dragging");
    if (g?.pinch) { // keep the remaining finger panning smoothly after a pinch
      if (ptrs.size === 1) { const p = [...ptrs.values()][0]; gest = { x0: p.x, y0: p.y, t0: Date.now(), zx: V.Z.x, zy: V.Z.y, moved: true, afterPinch: true }; if (V.Z.s < 1.06) zoomTo(1, 0, 0); return; }
      if (V.Z.s < 1.06) zoomTo(1, 0, 0);
    } else if (was === 1 && g) {
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = Date.now() - g.t0;
      if (e.pointerType !== "mouse" && V.Z.s < 1.02 && g.moved) {
        if (Math.abs(dx) > 50 && Math.abs(dx) > 1.4 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
        else if (dy > 90 && dy > 1.4 * Math.abs(dx)) closeViewer();
      } else if (e.pointerType !== "mouse" && !g.moved && dt < 300) {
        const now = Date.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          clearTimeout(tapTimer); lastTap = null; const [px, py] = rel(e); zoomToggle(px, py);
        } else { lastTap = { t: now, x: e.clientX, y: e.clientY }; clearTimeout(tapTimer); tapTimer = setTimeout(() => { V.el.classList.toggle("idle"); }, 330); }
      }
    }
    if (!ptrs.size) gest = null;
  };
  stage.addEventListener("pointerup", endPtr); stage.addEventListener("pointercancel", endPtr);
  stage.addEventListener("dblclick", (e) => { if (!V.img || lastType !== "mouse") return; const [px, py] = rel(e); zoomToggle(px, py); });
  stage.addEventListener("wheel", (e) => {
    if (!V.img) return; e.preventDefault();
    stage.classList.add("dragging"); clearTimeout(wheelT); wheelT = setTimeout(() => stage.classList.remove("dragging"), 140);
    const [px, py] = rel(e);
    if (!e.ctrlKey && V.Z.s > 1.02 && e.shiftKey) { panBy(-e.deltaY, 0); return; }
    zoomTo(V.Z.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), px, py);
    if (V.Z.s < 1.04) zoomTo(1, 0, 0);
  }, { passive: false });
  V.el.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") wake(); });
  if ("ResizeObserver" in window) new ResizeObserver(() => { if (V.img) fitImage(); }).observe(stage);

  /* ----- documents and fallback: Google's own preview ----- */
  function mountFrame(f, why) {
    setMode("frame");
    const fr = el("iframe", "v-frame"); fr.src = `https://drive.google.com/file/d/${f.id}/preview`; fr.allow = "autoplay; fullscreen"; fr.allowFullscreen = true; fr.title = f.name;
    stage.append(fr);
    const note = el("div", "v-note"); note.innerHTML = `${why ? esc(why) + " " : ""}Not loading? <a href="${esc(driveView(f))}" target="_blank" rel="noopener">Open in Drive</a>`;
    stage.append(note);
  }

  /* ----- videos: our own player ----- */
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const clock = (sec) => (isFinite(sec) ? fmtDur(sec * 1000) : "0:00");

  function mountVideo(f) {
    const vp = el("div", "vp");
    vp.innerHTML = `<video class="vp-video" playsinline preload="metadata"></video>
      <div class="v-spin vp-wait"></div>
      <button class="vp-big" type="button" aria-label="Play video">${ic("play")}</button>
      <div class="vp-hint" aria-hidden="true"></div>
      <div class="vp-bar">
        <input class="vp-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek" />
        <div class="vp-row">
          <button type="button" class="vp-play" aria-label="Play" title="Play / pause (Space)">${ic("play")}</button>
          <button type="button" class="vp-back" aria-label="Back 10 seconds" title="Back 10 seconds (J)">${ic("back10")}</button>
          <button type="button" class="vp-fwd" aria-label="Forward 10 seconds" title="Forward 10 seconds (L)">${ic("fwd10")}</button>
          <span class="vp-time">0:00 / 0:00</span>
          <span class="vp-gap"></span>
          <button type="button" class="vp-mute" aria-label="Mute" title="Mute (M)">${ic("vol")}</button>
          <input class="vp-vol" type="range" min="0" max="100" step="1" value="100" aria-label="Volume" />
          <button type="button" class="vp-speed" aria-label="Playback speed" title="Speed (&lt; &gt;)">1×</button>
          <button type="button" class="vp-loop" aria-label="Loop" aria-pressed="false" title="Loop (R)">${ic("loop")}</button>
          <button type="button" class="vp-pip" aria-label="Picture in picture" title="Picture in picture">${ic("pip")}</button>
          <button type="button" class="vp-fs" aria-label="Full screen" title="Full screen (F)">${ic("expand")}</button>
        </div>
      </div>`;
    stage.append(vp);
    const v = vp.querySelector("video"), q = (s) => vp.querySelector(s);
    const seek = q(".vp-seek"), vol = q(".vp-vol"), big = q(".vp-big"), wait = q(".vp-wait"), hint = q(".vp-hint");
    V.vid = v; let scrub = false, hintT = 0, failT = 0, done = false;
    v.poster = thumbSrc(f, 1200);
    if (!(document.pictureInPictureEnabled && v.requestPictureInPicture)) q(".vp-pip").hidden = true;
    if (!document.fullscreenEnabled && !v.webkitEnterFullscreen) q(".vp-fs").hidden = true;

    const fail = () => { if (done || V.vid !== v) return; done = true; clearTimeout(failT); teardown(); mountFrame(f, "This video can't play here, so Google's player is shown."); wake(); };
    v.addEventListener("error", fail);
    failT = setTimeout(() => { if (v.readyState === 0 && !v.error) fail(); }, 25000);
    v.src = mediaUrl(f);

    const paint = () => {
      const d = v.duration, t = v.currentTime;
      if (!scrub && d) seek.value = String(Math.round((t / d) * 1000));
      const b = v.buffered.length && d ? (v.buffered.end(v.buffered.length - 1) / d) * 100 : 0;
      seek.style.setProperty("--p", (d ? (t / d) * 100 : 0) + "%"); seek.style.setProperty("--b", b + "%");
      q(".vp-time").textContent = `${clock(t)} / ${clock(d)}`;
      seek.setAttribute("aria-valuetext", `${clock(t)} of ${clock(d)}`);
    };
    const paintPlay = () => {
      const ended = v.ended, playing = !v.paused && !ended, icn = ended ? "replay" : playing ? "pause" : "play";
      q(".vp-play").innerHTML = ic(icn); q(".vp-play").setAttribute("aria-label", playing ? "Pause" : ended ? "Replay" : "Play");
      big.innerHTML = ic(ended ? "replay" : "play"); vp.classList.toggle("playing", playing);
      wake();
    };
    const paintVol = () => {
      const m = v.muted || v.volume === 0;
      q(".vp-mute").innerHTML = ic(m ? "mute" : "vol"); q(".vp-mute").setAttribute("aria-label", m ? "Unmute" : "Mute");
      vol.value = String(m ? 0 : Math.round(v.volume * 100)); vol.style.setProperty("--p", vol.value + "%");
    };
    const say = (t) => { hint.textContent = t; hint.classList.add("on"); clearTimeout(hintT); hintT = setTimeout(() => hint.classList.remove("on"), 750); };
    const toggle = () => { if (v.ended) v.currentTime = 0; if (v.paused || v.ended) v.play().catch(() => {}); else v.pause(); };
    const jump = (d) => { if (!isFinite(v.duration)) return; v.currentTime = clamp(v.currentTime + d, 0, v.duration); say((d > 0 ? "+" : "−") + Math.abs(d) + "s"); paint(); wake(); };
    const setSpeed = (r) => { v.playbackRate = r; q(".vp-speed").textContent = r + "×"; say(r + "×"); };
    const cycleSpeed = (dir) => { const i = SPEEDS.indexOf(v.playbackRate); setSpeed(SPEEDS[clamp((i < 0 ? 2 : i) + dir, 0, SPEEDS.length - 1)]); };
    const toggleLoop = () => { v.loop = !v.loop; q(".vp-loop").setAttribute("aria-pressed", String(v.loop)); say(v.loop ? "Loop on" : "Loop off"); };
    const toggleMute = () => { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.6; paintVol(); };
    const pip = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); } catch { /* ignore */ } };

    ["timeupdate", "durationchange", "progress", "loadedmetadata", "seeked"].forEach((n) => v.addEventListener(n, paint));
    ["play", "pause", "ended"].forEach((n) => v.addEventListener(n, paintPlay));
    v.addEventListener("volumechange", paintVol);
    v.addEventListener("loadedmetadata", () => { clearTimeout(failT); wait.hidden = true; paint(); });
    v.addEventListener("waiting", () => { wait.hidden = false; });
    ["playing", "canplay", "loadeddata"].forEach((n) => v.addEventListener(n, () => { wait.hidden = true; }));
    wait.hidden = false;

    seek.addEventListener("pointerdown", () => { scrub = true; });
    seek.addEventListener("input", () => { if (v.duration) { v.currentTime = (+seek.value / 1000) * v.duration; paint(); } });
    const endScrub = () => { scrub = false; };
    seek.addEventListener("change", endScrub); seek.addEventListener("pointerup", endScrub); seek.addEventListener("blur", endScrub);
    vol.addEventListener("input", () => { v.muted = false; v.volume = +vol.value / 100; });

    q(".vp-play").onclick = toggle; big.onclick = toggle;
    q(".vp-back").onclick = () => jump(-10); q(".vp-fwd").onclick = () => jump(10);
    q(".vp-mute").onclick = toggleMute; q(".vp-speed").onclick = () => setSpeed(SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length]);
    q(".vp-loop").onclick = toggleLoop; q(".vp-pip").onclick = pip; q(".vp-fs").onclick = toggleFS;

    // click: play or pause. Double click or tap: seek on the left and right thirds (touch), full screen in the middle or with a mouse.
    let click = null;
    v.addEventListener("click", (e) => {
      const now = Date.now();
      if (click && now - click.t < 300) {
        clearTimeout(click.timer); click = null;
        const r = v.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
        if (lastType !== "mouse" && x < 0.33) jump(-10); else if (lastType !== "mouse" && x > 0.67) jump(10); else toggleFS();
        return;
      }
      click = { t: now, timer: setTimeout(() => { click = null; if (lastType !== "mouse" && V.el.classList.contains("idle")) { wake(); return; } toggle(); }, 300) };
    });

    V.vctl = { toggle, jump, cycleSpeed, toggleLoop, toggleMute, pip, say, vol: (d) => { v.muted = false; v.volume = clamp(v.volume + d, 0, 1); say("Volume " + Math.round(v.volume * 100) + "%"); }, seekPct: (p) => { if (isFinite(v.duration)) v.currentTime = v.duration * p; paint(); } };
    V.cleanup = () => { clearTimeout(failT); clearTimeout(hintT); V.vctl = null; if (document.pictureInPictureElement === v) document.exitPictureInPicture?.().catch(() => {}); };
    paint(); paintPlay(); paintVol();
  }

  function toggleFS() {
    if (document.fullscreenEnabled) { if (document.fullscreenElement) document.exitFullscreen(); else V.el.requestFullscreen().catch(() => {}); }
    else if (V.vid?.webkitEnterFullscreen) V.vid.webkitEnterFullscreen();
  }

  function paintStrip() {
    const st = $("#v-strip"); st.textContent = "";
    if (innerWidth < 900) return;
    const from = clamp(V.idx - 8, 0, Math.max(0, V.list.length - 17)), to = Math.min(V.list.length, from + 17);
    for (let j = from; j < to; j++) {
      const f = V.list[j], b = el("button", j === V.idx ? "cur" : ""); b.type = "button"; b.tabIndex = -1; b.dataset.i = j;
      if (f._k === "image" || f.thumbnailLink) { const im = new Image(); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = thumbSrc(f, 120); b.append(im); } else b.innerHTML = ic(f._k === "video" ? "video" : "file");
      st.append(b);
    }
  }

  function paintInfo(f) {
    const par = f.parents?.[0], folder = par && known.get(par)?.name;
    const m = f.imageMediaMetadata || f.videoMediaMetadata;
    const rows = [["Date", fmtDateLong(f._t)], ["Type", f._k === "image" ? (f.mimeType.split("/")[1] || "image").toUpperCase() : f._k === "video" ? "Video" : docLabel(f)]];
    if (f._size) rows.push(["Size", fmtSize(f._size)]);
    if (m?.width) rows.push(["Dimensions", `${m.width} × ${m.height}`]);
    if (f.videoMediaMetadata?.durationMillis) rows.push(["Length", fmtDur(+f.videoMediaMetadata.durationMillis)]);
    if (folder) rows.push(["Album", folder]);
    $("#v-panel").innerHTML = `<h3>${esc(f.name)}</h3><dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
      <div class="acts"><a class="btn sm" href="${esc(driveView(f))}" target="_blank" rel="noopener">${ic("external")}Open in Drive</a><button class="btn sm" type="button" id="p-copy">${ic("link")}Copy link</button></div>`;
    $("#p-copy").onclick = async () => toast((await copyText(fileUrl(f))) ? "Link copied" : "Couldn't copy the link");
  }

  function step(d) { const n = V.idx + d; if (n >= 0 && n < V.list.length) go(n); }
  function toggleInfo() { V.info = !V.info; $("#v-panel").hidden = !V.info; $("#v-info").setAttribute("aria-pressed", String(V.info)); if (V.info) paintInfo(V.list[V.idx]); wake(); }
  function togglePlay() {
    if (V.play) { stopPlay(); return; }
    if (!V.list.some((f) => f._k === "image")) { toast("Slideshows play photos only."); return; }
    V.play = setInterval(() => {
      for (let k = 1; k <= V.list.length; k++) { const j = (V.idx + k) % V.list.length; if (V.list[j]._k === "image") { go(j); return; } }
    }, 4000);
    $("#v-play").innerHTML = ic("pause"); $("#v-play").setAttribute("aria-label", "Pause slideshow"); toast("Slideshow playing. Press P to pause.");
  }
  function stopPlay() { if (!V.play) return; clearInterval(V.play); V.play = null; $("#v-play").innerHTML = ic("play"); $("#v-play").setAttribute("aria-label", "Start slideshow"); }
  function wake() {
    V.el.classList.remove("idle"); clearTimeout(V.idle);
    const keep = V.mode === "frame" || V.info || (V.mode === "vid" && (!V.vid || V.vid.paused));
    if (!keep) V.idle = setTimeout(() => V.el.classList.add("idle"), 3400);
  }

  async function openFromHash(fid) {
    if (!V.el.hidden && V.list[V.idx]?.id === fid) return;
    let f = S.map.get(fid);
    if (!f) {
      try {
        f = prep(await gget("/files/" + fid, { fields: FILE_FIELDS }));
        const par = f.parents?.[0];
        if (f._k === "folder" || !par) throw new Error("bad");
        await resolvePath(par);
        if (par !== S.path.at(-1).id) { S.q = ""; S.type = "all"; S.date = "any"; await loadFolder(par); }
        f = S.map.get(fid) || f;
      } catch { toast("That link isn't available."); history.replaceState(null, "", hashFor()); return; }
    }
    const list = S.order.filter((x) => x._k !== "folder"); const i = list.findIndex((x) => x.id === fid);
    if (i >= 0) showViewer(list, i, { push: false }); else showViewer([f], 0, { push: false });
  }


  /* ---------- AI edit ---------- */
  const EDIT = { api: (CFG.EDIT_API || "").replace(/\/$/, ""), open: false, busy: false, stack: [], f: null };
  const EDIT_IDEAS = ["Remove the background", "Make it black and white", "Brighten and enhance colours", "Turn it into a painting", "Make the sky a golden sunset", "Remove people in the background"];
  const edEl = () => $("#ed");

  // Reads the photo, shrinks it and returns { blob, mime, b64 } ready to send.
  async function edPrepare(src) {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
      const out = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(out); });
      return { blob: out, mime: "image/jpeg", b64 };
    } finally { URL.revokeObjectURL(url); }
  }
  function edShow() {
    const cur = EDIT.stack.at(-1); $("#ed-img").src = cur.url;
    const n = EDIT.stack.length - 1;
    $("#ed-acts").hidden = n === 0; $("#ed-ver").textContent = n ? `Edit ${n}` : "Original";
    $("#ed-undo").disabled = n === 0;
  }
  function edNote(t, bad) { const n = $("#ed-note"); n.textContent = t; n.classList.toggle("bad", !!bad); }
  async function openEditor() {
    const f = V.list[V.idx]; if (!EDIT.api || !f || f._k !== "image" || EDIT.open) return;
    EDIT.open = true; EDIT.f = f; EDIT.stack = []; stopPlay();
    edEl().hidden = false; $("#ed-prompt").value = ""; $("#ed-prompt").focus({ preventScroll: true });
    $("#ed-acts").hidden = true; $("#ed-ver").textContent = ""; edNote("Edits are made by AI on a copy of the photo. Your original in Drive is never changed.");
    $("#ed-img").removeAttribute("src"); $("#ed-busy").hidden = false; $("#ed-busy p").textContent = "Loading your photo…";
    try {
      const o = await edPrepare(mediaUrl(f));
      if (!EDIT.open || EDIT.f !== f) return;
      EDIT.stack = [{ url: URL.createObjectURL(o.blob), blob: o.blob, mime: o.mime, b64: o.b64 }]; edShow();
    } catch { edNote("Couldn't load this photo for editing. Check your connection and try again.", true); }
    $("#ed-busy").hidden = true;
  }
  function closeEditor() {
    if (!EDIT.open) return; EDIT.open = false; edEl().hidden = true;
    for (const s of EDIT.stack) URL.revokeObjectURL(s.url); EDIT.stack = []; EDIT.f = null; V.opener && $("#v-edit").focus({ preventScroll: true });
  }
  async function runEdit() {
    const prompt = $("#ed-prompt").value.trim(); const cur = EDIT.stack.at(-1);
    if (EDIT.busy || !cur) return; if (!prompt) { edNote("Describe the change you want first.", true); $("#ed-prompt").focus(); return; }
    EDIT.busy = true; $("#ed-go").disabled = true; $("#ed-busy").hidden = false; $("#ed-busy p").textContent = "Editing your photo. This takes 10 to 30 seconds."; edNote("");
    try {
      const pass = store.get("dg-edit-pass", "");
      const r = await fetch(EDIT.api + "/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, image: cur.b64, mimeType: cur.mime, passcode: pass }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { $("#ed-pass").hidden = false; $("#ed-pass").focus(); edNote(pass ? "That passcode isn't right." : "Enter the passcode to use AI edit.", true); return; }
      if (!r.ok) { edNote(j.message || "Couldn't edit this photo. Try again.", true); return; }
      const bin = Uint8Array.from(atob(j.image), (c) => c.charCodeAt(0)), blob = new Blob([bin], { type: j.mimeType || "image/png" });
      // the next edit starts from this result, so keep it small like the original
      const next = await edPrepare(blob);
      EDIT.stack.push({ url: URL.createObjectURL(blob), blob, mime: next.mime, b64: next.b64, full: blob }); edShow();
      $("#ed-prompt").value = ""; edNote(j.text ? j.text : "Done. Describe another change to keep editing, or download it.");
    } catch { edNote("Couldn't reach the edit service. Check your connection and try again.", true); }
    finally { EDIT.busy = false; $("#ed-go").disabled = false; $("#ed-busy").hidden = true; }
  }
  const edFile = () => { const cur = EDIT.stack.at(-1), base = (EDIT.f?.name || "photo").replace(/\.[^.]+$/, ""); return new File([cur.blob], `${base}-edited.${(cur.blob.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: cur.blob.type }); };
  function edDownload() { const f = edFile(), a = el("a"); a.href = URL.createObjectURL(f); a.download = f.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function edShare() { const f = edFile(); try { if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: f.name }); return; } } catch (e) { if (e.name === "AbortError") return; } edDownload(); }

  /* ---------- UI wiring ---------- */
  const PALETTES = [
    { id: "cyanotype", name: "Cyanotype", note: "Prussian blue on pale paper", sw: ["#1b5b8f", "#2a8fb5", "#eef2f3"] },
    { id: "lagoon", name: "Lagoon", note: "Deep teal and sea green", sw: ["#0f766e", "#2f9e6f", "#edf5f4"] },
    { id: "orchard", name: "Orchard", note: "Leaf green with a hint of lime", sw: ["#3f7d20", "#8aa62a", "#f1f4ec"] },
    { id: "dusk", name: "Dusk", note: "Violet fading to magenta", sw: ["#5b45c7", "#c04fb0", "#f2f0f8"] },
    { id: "ember", name: "Ember", note: "Warm orange and amber", sw: ["#c2410c", "#d99a00", "#f7f1ec"] },
    { id: "graphite", name: "Graphite", note: "Neutral greys with an amber spark", sw: ["#2b2b2b", "#d97706", "#f2f2f1"] },
  ];
  const root = document.documentElement, dark = matchMedia("(prefers-color-scheme: dark)");
  function applyLook() {
    const mode = root.dataset.mode || "auto"; root.dataset.theme = mode === "auto" ? (dark.matches ? "dark" : "light") : mode;
    const m = $("#meta-theme"); if (m) m.content = getComputedStyle(root).getPropertyValue("--paper").trim() || m.content;
  }
  function setLookMode(m) { root.dataset.mode = m; store.set("dg-mode", m); applyLook(); paintLook(); }
  function setPalette(id) { root.dataset.palette = id; store.set("dg-palette", id); applyLook(); paintLook(); }
  function paintLook() {
    $$("#t-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === (root.dataset.mode || "auto"))));
    $$("#t-palettes .sw").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === root.dataset.palette)));
    const pl = PALETTES.find((x) => x.id === root.dataset.palette); if (pl) $("#t-name").textContent = pl.name + ": " + pl.note;
  }
  dark.addEventListener?.("change", () => { if ((root.dataset.mode || "auto") === "auto") applyLook(); });
  function openLook() { paintLook(); $("#tsheet").hidden = false; $("#btn-theme").setAttribute("aria-expanded", "true"); $("#t-mode button[aria-pressed=true]")?.focus(); }
  function closeLook() { $("#tsheet").hidden = true; $("#btn-theme").setAttribute("aria-expanded", "false"); $("#btn-theme").focus(); }

  function openFilters() {
    const dates = $("#f-date");
    const years = [...new Set(baseList().map((f) => new Date(f._t).getFullYear()))].filter((y) => y > 1990).sort((a, b) => b - a);
    dates.innerHTML = `<option value="any">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="365">Last 12 months</option>` + years.map((y) => `<option value="y${y}">${y}</option>`).join("");
    dates.value = [...dates.options].some((o) => o.value === S.date) ? S.date : "any";
    $("#f-sort").value = S.sort; $("#f-group").value = S.group; $("#f-size").value = S.size;
    $$("#f-layout button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === S.layout)));
    $("#sheet").hidden = false; $("#btn-filters").setAttribute("aria-expanded", "true"); $("#f-sort").focus();
  }
  function closeFilters() { $("#sheet").hidden = true; $("#btn-filters").setAttribute("aria-expanded", "false"); $("#btn-filters").focus(); }

  function wire() {
    // delegated clicks in the gallery
    const content = $("#content");
    content.addEventListener("click", (e) => {
      if (S.skipClick) { S.skipClick = false; return; }
      const node = e.target.closest(".tile,.album"); if (!node) return;
      const f = S.map.get(node.dataset.id); if (!f) return;
      if (e.target.closest(".dl")) { downloadFiles([f]); return; }
      if (f._k === "folder") { navigateTo(f.id); return; }
      if (e.target.closest(".chk") || S.select) { toggleSel(f, node); return; }
      openById(f.id);
    });
    content.addEventListener("keydown", (e) => {
      const node = e.target.closest(".tile,.album"); if (!node || e.target !== node) return;
      const f = S.map.get(node.dataset.id); if (!f) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (f._k === "folder") navigateTo(f.id); else if (S.select) toggleSel(f, node); else openById(f.id); }
      else if ((e.key === "s" || e.key === "S") && f._k !== "folder") toggleSel(f, node);
    });
    // long-press to start selecting on touch screens
    let lp = null;
    content.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      const node = e.target.closest(".tile"); if (!node) return;
      const f = S.map.get(node.dataset.id); if (!f) return;
      lp = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { S.skipClick = true; toggleSel(f, node); navigator.vibrate?.(15); }, 480) };
    });
    const cancelLp = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
    content.addEventListener("pointermove", (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) cancelLp(); });
    content.addEventListener("pointerup", cancelLp); content.addEventListener("pointercancel", cancelLp);
    content.addEventListener("contextmenu", (e) => { if (e.target.closest(".tile") && e.pointerType !== "mouse") e.preventDefault(); });

    $("#status").addEventListener("click", (e) => {
      if (e.target.closest("#retry")) { folderCache.delete(S.path.at(-1).id); S.index = null; S.indexing = null; loadFolder(S.path.at(-1).id); }
      if (e.target.closest("#clear-btn")) clearFilters();
    });
    $("#reel").addEventListener("click", (e) => { const b = e.target.closest(".frame"); if (b) openById(b.dataset.id); });
    $("#crumbs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) navigateTo(S.path[+b.dataset.i].id); });
    $("#brand").addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); S.q = ""; S.type = "all"; S.date = "any"; $("#search").value = ""; history.pushState(null, "", location.pathname + location.search); window.scrollTo({ top: 0 }); applyHash(); });

    // search
    let st;
    $("#search").addEventListener("input", () => {
      $("#search-clear").hidden = !$("#search").value; clearTimeout(st);
      st = setTimeout(() => { S.q = $("#search").value.trim(); syncUrl(); if (S.q && S.scope === "all") ensureIndex(); render(); smartSearch(S.q); }, 160);
    });
    $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); $("#search").blur(); });
    $("#search-clear").onclick = () => { $("#search").value = ""; S.q = ""; aiSeq++; S.ai = null; S.aiState = ""; changed(); $("#search").focus(); };
    $("#scope").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.scope = b.dataset.scope; syncUrl(); if (S.scope === "all") ensureIndex(); render(); });

    // tabs
    $("#tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (!b) return; S.type = b.dataset.type; changed(); });

    // hero actions
    $("#btn-share").onclick = () => shareLink(folderUrl(S.path.at(-1).id), S.path.at(-1).name);
    $("#btn-slideshow").onclick = () => {
      const list = S.order.filter((f) => f._k !== "folder"); const i = list.findIndex((f) => f._k === "image"); if (i < 0) return;
      showViewer(list, i); if (!V.play) togglePlay();
    };

    // top bar
    $("#t-palettes").append(...PALETTES.map((x) => { const b = el("button", "sw"); b.type = "button"; b.dataset.p = x.id; b.setAttribute("aria-label", x.name); b.style.cssText = `--a:${x.sw[0]};--b:${x.sw[1]};--p:${x.sw[2]}`; b.innerHTML = `<i></i>${esc(x.name)}`; b.onclick = () => setPalette(x.id); return b; }));
    $$("#t-mode button").forEach((b) => (b.onclick = () => setLookMode(b.dataset.mode)));
    $$("#tsheet [data-close]").forEach((b) => (b.onclick = closeLook));
    $("#btn-theme").onclick = () => ($("#tsheet").hidden ? openLook() : closeLook());
    applyLook(); paintLook();
    $("#btn-select").onclick = () => { if (S.select) endSelect(); else { S.select = true; updateSel(); } };
    $("#btn-filters").onclick = () => ($("#sheet").hidden ? openFilters() : closeFilters());
    $$("#sheet [data-close]").forEach((b) => (b.onclick = closeFilters));
    $("#f-group").onchange = (e) => { S.group = e.target.value; store.set("dg-group", S.group); S.shown = 0; changed(); };
    $("#f-sort").onchange = (e) => { S.sort = e.target.value; store.set("dg-sort", S.sort); changed(); };
    $("#f-date").onchange = (e) => { S.date = e.target.value; changed(); };
    $("#f-size").oninput = (e) => { S.size = +e.target.value; store.set("dg-size", S.size); render(); };
    $("#f-layout").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return; S.layout = b.dataset.layout; store.set("dg-layout", S.layout);
      $$("#f-layout button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); S.shown = 0; render();
    });
    $("#f-reset").onclick = () => { S.group = "auto"; store.set("dg-group", "auto"); S.sort = "new"; S.date = "any"; S.size = 2; S.layout = "mosaic"; store.set("dg-sort", "new"); store.set("dg-size", 2); store.set("dg-layout", "mosaic"); S.shown = 0; changed(); openFilters(); };

    // selection bar
    $("#sel-done").onclick = endSelect;
    $("#sel-all").onclick = () => { for (const f of S.order) if (f._k !== "folder") { S.selected.set(f.id, f); } $$(".tile").forEach((t) => t.classList.toggle("sel", S.selected.has(t.dataset.id))); updateSel(); };
    $("#sel-dl").onclick = () => downloadFiles([...S.selected.values()]);
    $("#sel-link").onclick = async () => { const urls = [...S.selected.values()].map(fileUrl).join("\n"); toast((await copyText(urls)) ? `Copied ${plural(S.selected.size, "link")}` : "Couldn't copy the links"); };

    // viewer
    $("#v-close").onclick = () => closeViewer();
    $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
    $("#v-info").onclick = toggleInfo; $("#v-play").onclick = togglePlay;
    $("#v-share").onclick = () => { const f = V.list[V.idx]; shareLink(fileUrl(f), f.name); };
    $("#v-download").onclick = () => downloadFiles([V.list[V.idx]]);
    if (document.fullscreenEnabled) $("#v-full").onclick = toggleFS; else $("#v-full").hidden = true;
    $("#v-edit").onclick = openEditor; $("#ed-close").onclick = closeEditor;
    $("#ed-chips").append(...EDIT_IDEAS.map((t) => { const b = el("button", "chip"); b.type = "button"; b.textContent = t; b.onclick = () => { $("#ed-prompt").value = t; $("#ed-prompt").focus(); }; return b; }));
    $("#ed-form").addEventListener("submit", (e) => { e.preventDefault(); if (!$("#ed-pass").hidden) store.set("dg-edit-pass", $("#ed-pass").value); runEdit(); });
    $("#ed-prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ed-form").requestSubmit(); } });
    $("#ed-undo").onclick = () => { if (EDIT.stack.length > 1) { URL.revokeObjectURL(EDIT.stack.pop().url); edShow(); edNote(""); } };
    $("#ed-dl").onclick = edDownload; $("#ed-share").onclick = edShare;
    const showOrig = (on) => { if (EDIT.stack.length > 1) $("#ed-img").src = EDIT.stack[on ? 0 : EDIT.stack.length - 1].url; };
    const cmp = $("#ed-compare"); for (const [ev, on] of [["pointerdown", true], ["pointerup", false], ["pointerleave", false], ["pointercancel", false]]) cmp.addEventListener(ev, () => showOrig(on));
    cmp.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") showOrig(true); }); cmp.addEventListener("keyup", () => showOrig(false));
    $("#v-zin").onclick = () => zoomBy(1.5); $("#v-zout").onclick = () => zoomBy(1 / 1.5); $("#v-zreset").onclick = zoomReset;
    $("#v-strip").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(+b.dataset.i); });

    // keyboard
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if (!V.el.hidden) {
        if (EDIT.open) { if (e.key === "Escape") { closeEditor(); e.preventDefault(); } return; }
        const k = e.key, inBar = !!e.target.closest?.(".vp-bar"), onRange = e.target.type === "range";
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (k === "Escape") { if (!document.fullscreenElement) closeViewer(); wake(); return; }
        if (inBar && (k === " " || k === "Enter")) { wake(); return; } // let a focused control handle its own key
        if (onRange && /^Arrow/.test(k)) { wake(); return; }
        const vc = V.vctl, isImg = V.mode === "img";
        if (vc && (k === " " || k === "k" || k === "K")) { e.preventDefault(); vc.toggle(); }
        else if (vc && (k === "ArrowLeft" || k === "ArrowRight") && !e.shiftKey) { e.preventDefault(); vc.jump(k === "ArrowLeft" ? -5 : 5); }
        else if (vc && (k === "j" || k === "J")) vc.jump(-10);
        else if (vc && (k === "l" || k === "L")) vc.jump(10);
        else if (vc && (k === "ArrowUp" || k === "ArrowDown")) { e.preventDefault(); vc.vol(k === "ArrowUp" ? 0.05 : -0.05); }
        else if (vc && (k === "m" || k === "M")) vc.toggleMute();
        else if (vc && (k === "r" || k === "R")) vc.toggleLoop();
        else if (vc && (k === "<" || k === ">")) vc.cycleSpeed(k === ">" ? 1 : -1);
        else if (vc && /^[0-9]$/.test(k)) vc.seekPct(+k / 10);
        else if (vc && k === "Home") vc.seekPct(0);
        else if (k === "ArrowLeft" || k === "PageUp") step(-1);
        else if (k === "ArrowRight" || k === "PageDown") step(1);
        else if (isImg && V.Z.s > 1.02 && /^Arrow/.test(k)) { e.preventDefault(); panBy(k === "ArrowLeft" ? 90 : k === "ArrowRight" ? -90 : 0, k === "ArrowUp" ? 90 : k === "ArrowDown" ? -90 : 0); }
        else if (k === "i" || k === "I") toggleInfo();
        else if (k === "p" || k === "P") togglePlay();
        else if ((k === "e" || k === "E") && !$("#v-edit").hidden) openEditor();
        else if (k === "d" || k === "D") downloadFiles([V.list[V.idx]]);
        else if ((k === "f" || k === "F") && (document.fullscreenEnabled || V.vid?.webkitEnterFullscreen)) toggleFS();
        else if (isImg && (k === "+" || k === "=")) zoomBy(1.4);
        else if (isImg && (k === "-" || k === "_")) zoomBy(1 / 1.4);
        else if (isImg && k === "0") zoomReset();
        wake(); return;
      }
      if (e.key === "Escape") {
        if (!$("#tsheet").hidden) closeLook();
        else if (!$("#sheet").hidden) closeFilters();
        else if (typing && document.activeElement.id === "search") { if ($("#search").value) $("#search-clear").click(); else $("#search").blur(); }
        else if (S.select) endSelect();
      } else if (!typing && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))) { e.preventDefault(); $("#search").focus(); $("#search").select(); }
    });

    // chrome behaviour
    const bar = $("#bar"); const onScroll = () => bar.classList.toggle("stuck", scrollY > 6); addEventListener("scroll", onScroll, { passive: true }); onScroll();
    let lastW = 0;
    if ("ResizeObserver" in window) new ResizeObserver(() => {
      const w = content.clientWidth; if (!w || w === lastW) return; lastW = w;
      applySizes(); if (S.layout === "mosaic") for (const g of S.groups.values()) layoutGroup(g);
    }).observe(content);
    addEventListener("popstate", () => applyHash());
    document.addEventListener("fullscreenchange", () => {
      const on = !!document.fullscreenElement, l = on ? "Exit full screen" : "Full screen";
      $("#v-full").setAttribute("aria-label", l); $("#v-full").innerHTML = ic(on ? "shrink" : "expand");
      const b = $(".vp-fs"); if (b) { b.setAttribute("aria-label", l); b.innerHTML = ic(on ? "shrink" : "expand"); }
      if (V.img) fitImage();
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    $("#site-title").textContent = ROOT.name; document.title = ROOT.name; $("#title").textContent = ROOT.name;
    wire(); updateSel();
    if (!CFG.API_KEY || CFG.API_KEY.startsWith("YOUR_")) { S.started = true; S.done = true; S.error = "Add the Google API key to config.js to show the files."; render(); return; }
    applyHash();
  }
  boot();
})();
