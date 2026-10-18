(() => {
  "use strict";
  const CFG = window.DRIVE_GALLERY_CONFIG;
  const $ = (s) => document.querySelector(s);
  const API = "https://www.googleapis.com/drive/v3";
  const FIELDS = "nextPageToken,files(id,name,mimeType,thumbnailLink,modifiedTime,size,webViewLink,videoMediaMetadata(durationMillis))";

  const state = {
    token: null, tokenExp: 0, client: null,
    view: "folders", stack: [{ id: "root", name: "My Drive" }],
    query: "", sort: "name", layout: localStorage.getItem("dg-layout") || "grid",
    items: [], next: null, loading: false, gen: 0, viewIdx: -1, viewables: [],
  };
  const cache = new Map();

  /* ---------- helpers ---------- */
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const isFolder = (f) => f.mimeType === "application/vnd.google-apps.folder";
  const kind = (f) => isFolder(f) ? "folder" : f.mimeType.startsWith("image/") ? "image" : f.mimeType.startsWith("video/") ? "video" : "doc";
  const fmtSize = (b) => { b = +b; if (!b) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(b < 10 && i ? 1 : 0) + " " + u[i]; };
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtDur = (ms) => { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); };
  const bigThumb = (url, s) => url.replace(/=s\d+/, "=s" + s);

  const ICONS = {
    folder: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
    image: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 16l-5-5-9 9"/></svg>',
    video: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
    doc: '<svg class="ico" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  };

  /* ---------- auth ---------- */
  function configured() { return CFG.CLIENT_ID && !CFG.CLIENT_ID.startsWith("YOUR_"); }

  function initAuth() {
    if (!window.google || !google.accounts) return setTimeout(initAuth, 120);
    state.client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID, scope: CFG.SCOPE,
      hint: CFG.ALLOWED_EMAIL, // pre-selects the allowed account in Google's sign-in
      callback: (resp) => {
        if (resp.error) { toast("Sign-in failed: " + resp.error); return; }
        setToken(resp.access_token, resp.expires_in);
        localStorage.setItem("dg-signed-in", "1");
        start();
      },
    });
    const saved = sessionStorage.getItem("dg-token");
    const exp = +sessionStorage.getItem("dg-exp");
    if (saved && exp > Date.now() + 60000) { state.token = saved; state.tokenExp = exp; start(); }
    else if (localStorage.getItem("dg-signed-in")) state.client.requestAccessToken({ prompt: "" });
  }

  function setToken(t, sec) {
    state.token = t; state.tokenExp = Date.now() + sec * 1000;
    sessionStorage.setItem("dg-token", t); sessionStorage.setItem("dg-exp", state.tokenExp);
  }

  function ensureToken() {
    if (state.token && state.tokenExp > Date.now() + 30000) return Promise.resolve();
    return new Promise((res, rej) => {
      state.client.callback = (r) => { if (r.error) return rej(r.error); setToken(r.access_token, r.expires_in); res(); };
      state.client.requestAccessToken({ prompt: "" });
    });
  }

  async function api(path, params) {
    await ensureToken();
    const url = API + path + "?" + new URLSearchParams(params);
    const r = await fetch(url, { headers: { Authorization: "Bearer " + state.token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || r.statusText);
    return r.json();
  }

  // Sign out locally and show the sign-in screen with a message.
  function deny(msg) {
    if (state.token) google.accounts.oauth2.revoke(state.token);
    state.token = null; sessionStorage.clear(); localStorage.removeItem("dg-signed-in"); cache.clear();
    $("#app").hidden = true; $("#welcome").hidden = false;
    const w = $("#config-warning"); w.textContent = msg; w.hidden = false;
  }

  async function start() {
    let me;
    try { me = (await api("/about", { fields: "user(displayName,photoLink,emailAddress)" })).user; }
    catch (e) { return deny("Couldn't verify the signed-in account. Please try again."); }
    // Only the configured account may use this site.
    if (!me.emailAddress || me.emailAddress.toLowerCase() !== CFG.ALLOWED_EMAIL.toLowerCase())
      return deny("This gallery is private. Please sign in with " + CFG.ALLOWED_EMAIL + ".");
    $("#welcome").hidden = true; $("#app").hidden = false;
    applyLayout();
    $("#user").innerHTML = (me.photoLink ? `<img referrerpolicy="no-referrer" src="${me.photoLink}" alt="">` : "") + `<span></span>`;
    $("#user span").textContent = me.displayName || me.emailAddress;
    load(true);
  }

  /* ---------- data ---------- */
  function buildQuery() {
    const base = "trashed=false";
    const q = state.query.replace(/'/g, "\\'");
    if (q) return `name contains '${q}' and ${base}`;
    switch (state.view) {
      case "photos": return `mimeType contains 'image/' and ${base}`;
      case "videos": return `mimeType contains 'video/' and ${base}`;
      case "docs": return `(mimeType='application/pdf' or mimeType contains 'document' or mimeType contains 'spreadsheet' or mimeType contains 'presentation' or mimeType contains 'text/' or mimeType contains 'officedocument' or mimeType='application/msword') and ${base}`;
      case "starred": return `starred=true and ${base}`;
      default: return `'${state.stack.at(-1).id}' in parents and ${base}`;
    }
  }

  function orderBy() {
    const folderFirst = state.view === "folders" && !state.query ? "folder," : "";
    if (state.sort === "name") return folderFirst + "name_natural";
    return folderFirst + state.sort;
  }

  async function load(reset) {
    if (state.loading) { if (!reset) return; }
    if (reset) { state.gen++; state.items = []; state.next = null; $("#grid").innerHTML = ""; renderCrumbs(); }
    else if (!state.next) return;
    const gen = state.gen;
    const key = JSON.stringify([buildQuery(), orderBy()]);
    if (reset && cache.has(key)) {
      const c = cache.get(key); state.items = c.items.slice(); state.next = c.next;
      render(state.items); refreshViewables(); return;
    }
    state.loading = true; showSkeleton(reset);
    try {
      const data = await api("/files", {
        q: buildQuery(), orderBy: orderBy(), pageSize: CFG.PAGE_SIZE, fields: FIELDS,
        pageToken: state.next || "", supportsAllDrives: "false",
      });
      if (gen !== state.gen) return;
      const fresh = data.files || [];
      state.items = state.items.concat(fresh); state.next = data.nextPageToken || null;
      cache.set(key, { items: state.items.slice(), next: state.next });
      clearSkeleton();
      render(fresh, true); refreshViewables();
      if (!state.items.length) status("Nothing here yet.");
      else status("");
    } catch (e) {
      clearSkeleton();
      if (/invalid|credentials|401/i.test(e.message)) { state.token = null; sessionStorage.clear(); }
      status("Couldn't load files: " + e.message);
    } finally { state.loading = false; }
  }

  function status(msg) { const s = $("#status"); s.textContent = msg; s.hidden = !msg; }
  function showSkeleton(reset) { if (reset) { const g = $("#grid"); for (let i = 0; i < 12; i++) g.append(el("div", "skeleton")); } }
  function clearSkeleton() { document.querySelectorAll(".skeleton").forEach((n) => n.remove()); }

  /* ---------- render ---------- */
  function render(files, append) {
    const g = $("#grid"); if (!append) g.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const f of files) frag.append(card(f));
    g.append(frag);
    if (!state.items.length && !files.length) return;
  }

  function card(f) {
    const k = kind(f);
    const c = el("button", "card " + k);
    c.dataset.id = f.id;
    const thumb = el("div", "thumb");
    if (f.thumbnailLink && k !== "folder") {
      const img = new Image(); img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
      img.alt = ""; img.src = bigThumb(f.thumbnailLink, 400);
      img.onload = () => img.classList.add("ok");
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
    if (state.query) { c.append(el("span", "cur", `Results for “${state.query.replace(/</g, "&lt;")}”`)); return; }
    if (state.view !== "folders") {
      const t = { photos: "All photos", videos: "All videos", docs: "Documents", starred: "Starred" }[state.view];
      c.append(el("span", "cur", t)); return;
    }
    state.stack.forEach((s, i) => {
      if (i === state.stack.length - 1) { const x = el("span", "cur"); x.textContent = s.name; c.append(x); }
      else {
        const b = el("button"); b.textContent = s.name;
        b.onclick = () => { state.stack = state.stack.slice(0, i + 1); load(true); };
        c.append(b, el("span", "", "›"));
      }
    });
  }

  function open(f) {
    if (isFolder(f)) {
      state.query = ""; $("#search").value = ""; state.view = "folders"; setActiveNav();
      state.stack.push({ id: f.id, name: f.name }); load(true); window.scrollTo({ top: 0 }); return;
    }
    refreshViewables();
    openViewer(state.viewables.findIndex((x) => x.id === f.id));
  }

  /* ---------- viewer ---------- */
  function refreshViewables() { state.viewables = state.items.filter((f) => !isFolder(f)); }

  function openViewer(i) {
    if (i < 0) return;
    state.viewIdx = i; const f = state.viewables[i];
    const v = $("#viewer"), stage = $("#v-stage"); v.hidden = false; document.body.style.overflow = "hidden";
    $("#v-title").textContent = f.name; $("#v-count").textContent = `${i + 1} / ${state.viewables.length}`;
    $("#v-open").href = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;
    stage.innerHTML = "";
    if (kind(f) === "image") {
      const img = new Image(); img.alt = f.name; img.referrerPolicy = "no-referrer";
      if (f.thumbnailLink) { img.src = bigThumb(f.thumbnailLink, 2000); img.onerror = () => fullImage(f, img); }
      else fullImage(f, img);
      stage.append(img);
      [i - 1, i + 1].forEach((j) => { const n = state.viewables[j]; if (n && kind(n) === "image" && n.thumbnailLink) new Image().src = bigThumb(n.thumbnailLink, 2000); });
    } else {
      const fr = document.createElement("iframe");
      fr.src = `https://drive.google.com/file/d/${f.id}/preview`; fr.allow = "autoplay; fullscreen"; fr.allowFullscreen = true;
      stage.append(fr);
    }
    $("#v-prev").hidden = i === 0; $("#v-next").hidden = i === state.viewables.length - 1;
    if (i >= state.viewables.length - 6 && state.next) load(false).then(() => { $("#v-next").hidden = state.viewIdx >= state.viewables.length - 1; });
  }

  async function fullImage(f, img) {
    try {
      await ensureToken();
      const r = await fetch(`${API}/files/${f.id}?alt=media`, { headers: { Authorization: "Bearer " + state.token } });
      if (!r.ok) throw new Error(r.statusText);
      img.src = URL.createObjectURL(await r.blob());
    } catch (e) { toast("Couldn't load that image."); }
  }

  const step = (d) => { const n = state.viewIdx + d; if (n >= 0 && n < state.viewables.length) openViewer(n); };
  function closeViewer() { $("#viewer").hidden = true; $("#v-stage").innerHTML = ""; document.body.style.overflow = ""; }

  /* ---------- UI wiring ---------- */
  function setActiveNav() { document.querySelectorAll(".nav").forEach((n) => n.classList.toggle("active", n.dataset.view === state.view && !state.query)); }
  function applyLayout() {
    $("#grid").classList.toggle("list", state.layout === "list");
    $("#layout-grid").classList.toggle("active", state.layout === "grid");
    $("#layout-list").classList.toggle("active", state.layout === "list");
  }
  function applyTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem("dg-theme", t); }

  function wire() {
    $("#signin").onclick = () => state.client.requestAccessToken();
    $("#signout").onclick = () => {
      if (state.token) google.accounts.oauth2.revoke(state.token);
      sessionStorage.clear(); localStorage.removeItem("dg-signed-in"); cache.clear(); location.reload();
    };
    document.querySelectorAll(".nav").forEach((b) => b.onclick = () => {
      state.view = b.dataset.view; state.query = ""; $("#search").value = "";
      if (state.view === "folders") state.stack = [{ id: "root", name: "My Drive" }];
      setActiveNav(); $("#sidebar").classList.remove("open"); load(true);
    });
    $("#search-form").onsubmit = (e) => { e.preventDefault(); state.query = $("#search").value.trim(); setActiveNav(); load(true); };
    $("#search").addEventListener("input", (e) => { if (!e.target.value && state.query) { state.query = ""; setActiveNav(); load(true); } });
    $("#sort").onchange = (e) => { state.sort = e.target.value; load(true); };
    $("#layout-grid").onclick = () => { state.layout = "grid"; localStorage.setItem("dg-layout", "grid"); applyLayout(); };
    $("#layout-list").onclick = () => { state.layout = "list"; localStorage.setItem("dg-layout", "list"); applyLayout(); };
    $("#theme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    $("#menu").onclick = () => $("#sidebar").classList.toggle("open");
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
  const pref = localStorage.getItem("dg-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(pref);
  wire();
  if (!configured()) { $("#config-warning").hidden = false; $("#signin").disabled = true; }
  else initAuth();
})();
