/* Smart search: type what is in a photo ("cat", "beach at sunset"). The photos are embedded ahead of time by
   scripts/build-index.mjs; the words are embedded here in the browser with the same CLIP model (downloaded once, then cached). */
(function () {
  const MODEL = "Xenova/clip-vit-base-patch32", LIB = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
  const MIN = 0.2, BAND = 0.05, CAP = 120;
  let indexP = null, modelP = null; const cache = new Map();

  function loadIndex() {
    return (indexP ||= fetch("search-index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || j.model !== MODEL || !j.items) return null;
      const m = new Map();
      for (const [id, o] of Object.entries(j.items)) { const s = atob(o.e), a = new Int8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) << 24 >> 24; m.set(id, a); }
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
    const { text_embeds } = await model(tok(["a photo of " + q], { padding: true, truncation: true }));
    const v = text_embeds.data; let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  }
  function rank(vec, index, allowed) {
    const all = [];
    for (const [id, a] of index) { if (allowed && !allowed.has(id)) continue; let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * vec[i]; all.push([id, d / 127]); }
    all.sort((x, y) => y[1] - x[1]);
    const best = all[0]?.[1] ?? 0, out = new Map();
    for (const [id, s] of all) { if (out.size >= CAP || s < MIN || s < best - BAND) break; out.set(id, s); }
    return out;
  }

  window.SmartSearch = {
    // true when a search index has been built for this site
    available: async () => !!(await loadIndex()),
    // returns Map(fileId -> score) of photos that look like the words, or null when smart search can't run
    async search(q, onStatus) {
      const key = q.toLowerCase(); if (cache.has(key)) return cache.get(key);
      const index = await loadIndex(); if (!index) return null;
      if (navigator.connection?.saveData && !modelP) return null;
      const res = rank(await embedText(q, onStatus), index);
      cache.set(key, res); return res;
    },
    _rank: rank,
  };
})();
