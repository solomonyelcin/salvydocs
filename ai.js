/* Smart search: type what is in a photo ("cat", "beach at sunset"). The photos are embedded ahead of time by
   scripts/build-index.mjs; the words are embedded here in the browser with the same CLIP model (downloaded once, then cached). */
(function () {
  const MODEL = "Xenova/clip-vit-base-patch32", LIB = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
  const MIN = 0.2, Z = [2.4, 1.6], CAP = [48, 200]; // how far above the typical photo a match must score: strict, then broader
  let indexP = null, modelP = null, themeMap = new Map(); const cache = new Map();

  function loadIndex() {
    return (indexP ||= fetch("search-index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || j.model !== MODEL || j.v !== 2 || !j.items) return null;
      const m = new Map(); themeMap = new Map();
      for (const [id, o] of Object.entries(j.items)) { if (o.t != null && j.labels?.[o.t]) themeMap.set(id, j.labels[o.t]); m.set(id, o.e.map((b) => { const s = atob(b), a = new Int8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) << 24 >> 24; return a; })); }
      return m.size ? m : null;
    }).catch(() => null));
  }
  function loadModel(onStatus) {
    return (modelP ||= (async () => {
      const T = await import(LIB); T.env.allowLocalModels = false;
      let last = 0; const progress_callback = (p) => { if (p.status === "progress" && p.progress != null && Date.now() - last > 250) { last = Date.now(); onStatus?.(`Preparing smart search, ${Math.round(p.progress)}%`); } };
      const tok = await T.AutoTokenizer.from_pretrained(MODEL, { progress_callback });
      const model = await T.CLIPTextModelWithProjection.from_pretrained(MODEL, { quantized: true, progress_callback });
      return { tok, model };
    })().catch((e) => { modelP = null; throw e; }));
  }
  async function embedText(q, onStatus) {
    const { tok, model } = await loadModel(onStatus);
    // a few phrasings of the same words, averaged, are more reliable than one
    const prompts = ["a photo of " + q, "a close-up photo of " + q, "a photo with " + q + " in it"];
    const { text_embeds } = await model(tok(prompts, { padding: true, truncation: true }));
    const d = text_embeds.data, dim = d.length / prompts.length, v = new Float32Array(dim);
    for (let p = 0; p < prompts.length; p++) { let n = 0; for (let i = 0; i < dim; i++) n += d[p * dim + i] ** 2; n = Math.sqrt(n) || 1; for (let i = 0; i < dim; i++) v[i] += d[p * dim + i] / n; }
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  }
  // Score each photo by its best-matching part, then keep only photos that stand out from the rest of the library.
  function rank(vec, index, more) {
    const all = []; let sum = 0, sq = 0;
    for (const [id, parts] of index) {
      let best = -1;
      for (const a of parts) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * vec[i]; d /= 127; if (d > best) best = d; }
      all.push([id, best]); sum += best; sq += best * best;
    }
    const n = all.length || 1, mean = sum / n, sd = Math.sqrt(Math.max(1e-9, sq / n - mean * mean));
    const cut = Math.max(MIN, mean + Z[more ? 1 : 0] * sd), cap = CAP[more ? 1 : 0];
    all.sort((x, y) => y[1] - x[1]);
    const out = new Map(); let total = 0;
    for (const [id, s] of all) if (s >= cut) { total++; if (out.size < cap) out.set(id, s); }
    out.total = total; return out;
  }

  window.SmartSearch = {
    // true when a search index has been built for this site
    // Map(fileId -> theme name) from the pre-built index, or null when there is no index
    themes: async () => ((await loadIndex()) ? themeMap : null),
    available: async () => !!(await loadIndex()),
    // returns Map(fileId -> score) of photos that look like the words, or null when smart search can't run
    async search(q, onStatus, more = false) {
      const key = q.toLowerCase() + (more ? "|more" : ""); if (cache.has(key)) return cache.get(key);
      const index = await loadIndex(); if (!index) return null;
      if (navigator.connection?.saveData && !modelP) return null;
      const res = rank(await embedText(q, onStatus), index, more);
      cache.set(key, res); return res;
    },
    _rank: rank,
  };
})();
