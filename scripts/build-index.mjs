// Builds search-index.json: one CLIP image embedding per photo, so the site can search by what is IN the photos.
// Runs in GitHub Actions on every deploy and nightly. Reuses embeddings of photos that have not changed.
import fs from "node:fs";

const cfg = fs.readFileSync("config.js", "utf8");
const pick = (k) => (cfg.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')) || [])[1];
const KEY = process.env.DRIVE_API_KEY || pick("API_KEY");
const ROOT = process.env.ROOT_FOLDER_ID || pick("ROOT_FOLDER_ID");
const SITE = (process.env.SITE_URL || "https://solomonyelcin.github.io/salvydocs/").replace(/\/?$/, "/");
const MODEL = "Xenova/clip-vit-base-patch32";
const API = process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";
const OUT = process.env.OUT || "search-index.json";
const MAX = +process.env.MAX_NEW || 100000;
// The API key is restricted to the website, so requests send the site as the referrer.
const H = { Referer: SITE };

const api = async (path, params) => {
  const u = new URL(API + path); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); u.searchParams.set("key", KEY);
  for (let a = 0; a < 4; a++) {
    const r = await fetch(u, { headers: H });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 800 * (a + 1))); continue; }
    throw new Error(`Drive ${r.status} for ${path}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("Drive API kept failing for " + path);
};

async function listPhotos() {
  const photos = [], seen = new Set(), queue = [ROOT];
  while (queue.length) {
    const id = queue.shift(); if (seen.has(id)) continue; seen.add(id);
    let token;
    do {
      const r = await api("/files", { q: `'${id}' in parents and trashed=false`, pageSize: "1000", fields: "nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,thumbnailLink)", ...(token ? { pageToken: token } : {}) });
      for (const f of r.files || []) {
        if (f.mimeType === "application/vnd.google-apps.folder") queue.push(f.id);
        else if (f.mimeType.startsWith("image/") && !/svg|gif/.test(f.mimeType)) photos.push(f);
      }
      token = r.nextPageToken;
    } while (token);
  }
  return photos;
}

async function download(f) {
  const urls = [];
  if (f.thumbnailLink) urls.push(f.thumbnailLink.replace(/=s\d+.*$/, "") + "=s800");
  urls.push(`https://drive.google.com/thumbnail?id=${f.id}&sz=w800`, `${API}/files/${f.id}?alt=media&key=${KEY}`);
  for (const u of urls) {
    try { const r = await fetch(u, { headers: H }); if (r.ok && /^image\//.test(r.headers.get("content-type") || "")) return Buffer.from(await r.arrayBuffer()); } catch { /* try next */ }
  }
  throw new Error("could not download " + f.name);
}

// Themes: each photo gets the closest of these labels (or none), used by the "Themes" grouping.
const THEMES = [["Beach and sea", "a beach or the sea"], ["Mountains and nature", "mountains, hills or a forest"], ["Sunsets and sky", "a sunset or the sky"], ["Snow", "snow"], ["Food", "a plate of food or a meal"], ["Cakes and celebrations", "a birthday cake or a party"], ["Weddings", "a wedding"], ["Festivals and temples", "a festival, temple or religious ceremony"], ["Pets and animals", "a pet dog, cat or other animal"], ["Flowers and plants", "flowers or plants"], ["Kids and babies", "a baby or small children"], ["Group photos", "a group of people posing together"], ["Portraits and selfies", "a portrait or selfie of a person"], ["Sports and games", "sports, a ball or a game"], ["Travel and landmarks", "a famous landmark or a city street"], ["Vehicles", "a car, bike, bus, train or plane"], ["At home", "the inside of a home"], ["Documents and screenshots", "a document, text or screenshot"]];
const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
const quant = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Int8Array.from(v, (x) => Math.round((x / n) * 127)); };

async function previous() {
  try { const r = await fetch(SITE + "search-index.json", { headers: { "Cache-Control": "no-cache" } }); if (r.ok) { const j = await r.json(); if (j.model === MODEL && j.v === 2) return j.items || {}; } } catch { /* first run */ }
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")).items || {}; } catch { return {}; }
}

const photos = await listPhotos();
console.log(`Found ${photos.length} photos.`);
const old = await previous();
const items = {}; const todo = [];
for (const f of photos) { const key = f.md5Checksum || f.modifiedTime; const o = old[f.id]; if (o && o.k === key) items[f.id] = o; else todo.push([f, key]); }
console.log(`${Object.keys(items).length} unchanged, ${todo.length} to embed.`);

if (todo.length) {
  const T = process.env.MOCK_EMBED ? null : await import("@xenova/transformers");
  let embed;
  if (T) {
    const proc = await T.AutoProcessor.from_pretrained(MODEL);
    const vision = await T.CLIPVisionModelWithProjection.from_pretrained(MODEL, { quantized: true });
    // The whole photo plus its four quarters, so small things (a ball in a big scene) still show up.
    const one = async (img) => { const { image_embeds } = await vision(await proc(img)); return image_embeds.data; };
    embed = async (buf) => {
      const img = await T.RawImage.fromBlob(new Blob([buf])), w = img.width, h = img.height, out = [await one(img)];
      const x = Math.floor(w * 0.55), y = Math.floor(h * 0.55); // quarters overlap a little
      for (const [x0, y0] of [[0, 0], [w - x, 0], [0, h - y], [w - x, h - y]]) out.push(await one(await img.crop([x0, y0, x0 + x - 1, y0 + y - 1])));
      return out;
    };
  } else embed = async (buf) => [0, 1, 2, 3, 4].map((c) => Float32Array.from({ length: 512 }, (_, i) => Math.sin(i + buf.length + c))); // test stand-in
  let done = 0, failed = 0;
  for (const [f, key] of todo.slice(0, MAX)) {
    try { items[f.id] = { k: key, e: (await embed(await download(f))).map((v) => b64(quant(v))) }; } catch (e) { failed++; console.warn("skip", f.name, e.message); }
    if (++done % 25 === 0) console.log(`  ${done}/${todo.length}`);
  }
  console.log(`Embedded ${done - failed}, skipped ${failed}.`);
}
let labels = [];
if (!process.env.MOCK_EMBED && Object.keys(items).length) {
  try {
    const T = await import("@xenova/transformers");
    const tok = await T.AutoTokenizer.from_pretrained(MODEL), tm = await T.CLIPTextModelWithProjection.from_pretrained(MODEL, { quantized: true });
    const vecs = [];
    for (const [, phrase] of THEMES) {
      const prompts = ["a photo of " + phrase, "a close-up photo of " + phrase, "a photo with " + phrase + " in it"];
      const { text_embeds } = await tm(tok(prompts, { padding: true, truncation: true })); const d = text_embeds.data, dim = d.length / 3, v = new Float32Array(dim);
      for (let p = 0; p < 3; p++) { let n = 0; for (let i = 0; i < dim; i++) n += d[p * dim + i] ** 2; n = Math.sqrt(n); for (let i = 0; i < dim; i++) v[i] += d[p * dim + i] / n; }
      let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n); vecs.push(v.map((x) => x / n));
    }
    labels = THEMES.map(([name]) => name);
    for (const it of Object.values(items)) {
      const a = Int8Array.from(Buffer.from(it.e[0], "base64")); // whole-photo vector
      const sc = vecs.map((v) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * v[i]; return (d / 127) * 100; });
      const mx = Math.max(...sc), ex = sc.map((x) => Math.exp(x - mx)), sum = ex.reduce((p, c) => p + c, 0), best = ex.indexOf(1);
      if (ex[best] / sum >= 0.4) it.t = best; else delete it.t;
    }
    console.log(`Themes: ${Object.values(items).filter((x) => x.t != null).length} photos labelled.`);
  } catch (e) { console.warn("Themes skipped:", e.message); }
}
fs.writeFileSync(OUT, JSON.stringify({ v: 2, model: MODEL, dim: 512, labels, items }));
console.log(`Wrote ${OUT} with ${Object.keys(items).length} photos.`);
