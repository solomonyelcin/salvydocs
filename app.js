(() => {
  "use strict";
  const CFG = window.GALLERY_CONFIG;
  const $ = (s) => document.querySelector(s);
  const API = "https://www.googleapis.com/drive/v3";
  const FIELDS = "nextPageToken,files(id,name,mimeType,thumbnailLink,modifiedTime,size,webViewLink,videoMediaMetadata(durationMillis))";
  const FOLDER = "application/vnd.google-apps.folder";

  const state = {
    stack: [{ id: CFG.ROOT_FOLDER_ID, name: CFG.ROOT_NAME }],
    filter: "all", query: "", sort: "name", layout: localStorage.getItem("dg-layout") || "grid",
    items: [], next: null, loading: false, gen: 0, viewIdx: -1, viewables: [],
  };
  const cache = new Map();

  /* ---------- helpers ---------- */
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const isFolder = (f) => f.mimeType === FOLDER;
  const kind = (f) => isFolder(f) ? "folder" : f.mimeType.startsWith("image/") ? "image" : f.mimeType.startsWith("video/") ? "video" : "doc";
  const fmtSize = (b) => { b = +b; if (!b) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(b < 10 && i ? 1 : 0) + " " + u[i]; };
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtDur = (ms) => { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); };
  const sized = (url, s) => url.replace(/=s\d+/, "=s" + s);
  const fallbackThumb = (id, w) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`;

  const ICONS = {
    folder: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
    image: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 16l-5-5-9 9"/></svg>',
    video: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
    doc: '<svg class="ico" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  };

  /* ---------- data (public folder, read with an API key, no sign-in) ---------- */
  const configured = () => CFG.API_KEY && !CFG.API_KEY.startsWith("YOUR_");

  async function list(params) {
    const url = API + "/files?" + new URLSearchParams({ ...params, key: CFG.API_KEY });
    const r = await fetch(url);
    if (!r.ok) {
      const msg = (await r.json().catch(() => ({}))).error?.message || r.statusText;
      throw new Error(r.status === 403 || r.status === 404
        ? "These files aren't available right now. Check that the folder is shared with “Anyone with the link” and the API key allows this site."
        : msg);
    }
    return r.json();
  }

  function buildQuery() {
    const parent = state.stack.at(-1).id;
    let q = `'${parent}' in parents and trashed=false`;
    if (state.query) q += ` and name contains '${state.query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    const f = "mimeType = '" + FOLDER + "'";
    if (state.filter === "photos") q += ` and (mimeType contains 'image/' or ${f})`;
    else if (state.filter === "videos") q += ` and (mimeType contains 'video/' or ${f})`;
    else if (state.filter === "docs") q += ` and (mimeType = 'application/pdf' or mimeType contains 'document' or mimeType contains 'spreadsheet' or mimeType contains 'presentation' or mimeType contains 'text/' or mimeType contains 'officedocument' or mimeType = 'application/msword' or ${f})`;
    return q;
  }

  function orderBy() { return "folder," + (state.sort === "name" ? "name_natural" : state.sort); }

  async function load(reset) {
    if (reset) { state.gen++; state.items = []; state.next = null; state.loading = false; $("#grid").innerHTML = ""; renderCrumbs(); status(""); }
    else if (!state.next || state.loading) return;
    if (state.loading) return;
    const gen = state.gen;
    const key = JSON.stringify([buildQuery(), orderBy()]);
    if (reset && cache.has(key)) {
      const c = cache.get(key); state.items = c.items.slice(); state.next = c.next;
      render(state.items); refreshViewables(); status(state.items.length ? "" : "Nothing here yet."); return;
    }
    state.loading = true; showSkeleton(reset);
    try {
      const data = await list({ q: buildQuery(), orderBy: orderBy(), pageSize: CFG.PAGE_SIZE, fields: FIELDS, pageToken: state.next || "" });
      if (gen !== state.gen) return;
      const fresh = data.files || [];
      state.items = state.items.concat(fresh); state.next = data.nextPageToken || null;
      cache.set(key, { items: state.items.slice(), next: state.next });
      clearSkeleton(); render(fresh); refreshViewables();
      status(state.items.length ? "" : (state.query ? "No matches in this folder." : "Nothing here yet."));
    } catch (e) {
      if (gen === state.gen) { clearSkeleton(); status(e.message); }
    } finally { if (gen === state.gen) state.loading = false; }
  }

  function status(msg) { const s = $("#status"); s.textContent = msg; s.hidden = !msg; }
  function showSkeleton(reset) { if (reset) { const g = $("#grid"); for (let i = 0; i < 12; i++) g.append(el("div", "skeleton")); } }
  function clearSkeleton() { document.querySelectorAll(".skeleton").forEach((n) => n.remove()); }

  /* ---------- render ---------- */
  function render(files) {
    const frag = document.createDocumentFragment();
    for (const f of files) frag.append(card(f));
    $("#grid").append(frag);
  }

  function card(f) {
    const k = kind(f);
    const c = el("button", "card " + k);
    c.dataset.id = f.id;
    const thumb = el("div", "thumb");
    if (k !== "folder") {
      const img = new Image(); img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer"; img.alt = "";
      let tried = false;
      img.onerror = () => { if (!tried) { tried = true; img.src = fallbackThumb(f.id, 400); } };
      img.onload = () => img.classList.add("ok");
      img.src = f.thumbnailLink ? sized(f.thumbnailLink, 400) : fallbackThumb(f.id, 400);
      thumb.append(img);
    }
    thumb.insertAdjacentHTML("beforeend", ICONS[k]);
    if (k === "video") {
      thumb.insertAdjacentHTML("beforeend", '<div class="play"><i><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></i></div>');
      const d = f.videoMediaMetadata?.durationMillis; if (d) thumb.append(el("span", "badge", fmtDur(+d)));
    } else if (k === "doc") {
      const ext = (f.name.split(".").pop() || "").toUpperCase();
      if (ext.length <= 4 && ext !== f.name.toUpperCase()) thumb.append(el("span", "badge", ext));
    }
    const meta = el("div", "meta");
    const n = el("div", "name"); n.textContent = f.name; n.title = f.name;
    const s = el("div", "sub"); s.textContent = k === "folder" ? "Folder" : [fmtDate(f.modifiedTime), fmtSize(f.size)].filter(Boolean).join(" · ");
    meta.append(n, s); c.append(thumb, meta);
    c.addEventListener("click", () => open(f));
    return c;
  }

  function renderCrumbs() {
    const c = $("#crumbs"); c.innerHTML = "";
    state.stack.forEach((s, i) => {
      if (i === state.stack.length - 1) { const x = el("span", "cur"); x.textContent = s.name; c.append(x); }
      else {
        const b = el("button"); b.textContent = s.name;
        b.onclick = () => { state.stack = state.stack.slice(0, i + 1); state.query = ""; $("#search").value = ""; load(true); };
        c.append(b, el("span", "", "›"));
      }
    });
  }

  function open(f) {
    if (isFolder(f)) {
      state.query = ""; $("#search").value = "";
      state.stack.push({ id: f.id, name: f.name }); load(true); window.scrollTo({ top: 0 }); return;
    }
    refreshViewables();
    openViewer(state.viewables.findIndex((x) => x.id === f.id));
  }

  /* ---------- viewer ---------- */
  function refreshViewables() { state.viewables = state.items.filter((f) => !isFolder(f)); }

  function imageSrc(f) { return f.thumbnailLink ? sized(f.thumbnailLink, 2000) : fallbackThumb(f.id, 2000); }

  function openViewer(i) {
    if (i < 0) return;
    state.viewIdx = i; const f = state.viewables[i];
    const v = $("#viewer"), stage = $("#v-stage"); v.hidden = false; document.body.style.overflow = "hidden";
    $("#v-title").textContent = f.name; $("#v-count").textContent = `${i + 1} / ${state.viewables.length}`;
    $("#v-open").href = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;
    stage.innerHTML = "";
    if (kind(f) === "image") {
      const img = new Image(); img.alt = f.name; img.referrerPolicy = "no-referrer";
      let step = 0;
      img.onerror = () => {
        step++;
        if (step === 1) img.src = fallbackThumb(f.id, 2000);
        else if (step === 2) img.src = `${API}/files/${f.id}?alt=media&key=${CFG.API_KEY}`;
        else toast("Couldn't load that image.");
      };
      img.src = imageSrc(f);
      stage.append(img);
      [i - 1, i + 1].forEach((j) => { const n = state.viewables[j]; if (n && kind(n) === "image") new Image().src = imageSrc(n); });
    } else {
      const fr = document.createElement("iframe");
      fr.src = `https://drive.google.com/file/d/${f.id}/preview`; fr.allow = "autoplay; fullscreen"; fr.allowFullscreen = true;
      stage.append(fr);
    }
    $("#v-prev").hidden = i === 0; $("#v-next").hidden = i === state.viewables.length - 1;
    if (i >= state.viewables.length - 6 && state.next) load(false).then(() => { $("#v-next").hidden = state.viewIdx >= state.viewables.length - 1; });
  }

  const step = (d) => { const n = state.viewIdx + d; if (n >= 0 && n < state.viewables.length) openViewer(n); };
  function closeViewer() { $("#viewer").hidden = true; $("#v-stage").innerHTML = ""; document.body.style.overflow = ""; }

  /* ---------- UI wiring ---------- */
  function applyLayout() {
    $("#grid").classList.toggle("list", state.layout === "list");
    $("#layout-grid").classList.toggle("active", state.layout === "grid");
    $("#layout-list").classList.toggle("active", state.layout === "list");
  }
  function applyTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem("dg-theme", t); }

  function wire() {
    document.querySelectorAll(".chip").forEach((b) => b.onclick = () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === b));
      load(true);
    });
    $("#search-form").onsubmit = (e) => { e.preventDefault(); state.query = $("#search").value.trim(); load(true); };
    $("#search").addEventListener("input", (e) => { if (!e.target.value && state.query) { state.query = ""; load(true); } });
    $("#sort").onchange = (e) => { state.sort = e.target.value; load(true); };
    $("#layout-grid").onclick = () => { state.layout = "grid"; localStorage.setItem("dg-layout", "grid"); applyLayout(); };
    $("#layout-list").onclick = () => { state.layout = "list"; localStorage.setItem("dg-layout", "list"); applyLayout(); };
    $("#theme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    $("#v-close").onclick = closeViewer; $("#v-prev").onclick = () => step(-1); $("#v-next").onclick = () => step(1);
    $("#viewer").addEventListener("click", (e) => { if (e.target.id === "v-stage") closeViewer(); });

    document.addEventListener("keydown", (e) => {
      if (!$("#viewer").hidden) {
        if (e.key === "Escape") closeViewer();
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
      } else if (e.key === "/" && document.activeElement !== $("#search")) { e.preventDefault(); $("#search").focus(); }
    });

    new IntersectionObserver((en) => { if (en[0].isIntersecting && state.next && !state.loading) load(false); }, { rootMargin: "800px" }).observe($("#sentinel"));
  }

  /* ---------- boot ---------- */
  applyTheme(localStorage.getItem("dg-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  document.title = CFG.ROOT_NAME; $("#site-title").textContent = CFG.ROOT_NAME;
  applyLayout(); wire();
  if (!configured()) { renderCrumbs(); status("Add the Google API key to config.js to show the files."); }
  else load(true);
})();
