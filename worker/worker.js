// Cloudflare Worker: the only place the Gemini API key lives. The gallery sends a photo and a prompt here.
// It checks the site, an optional passcode and daily limits, then asks Gemini to edit the photo.

const enc = new TextEncoder();
const same = (a, b) => { a = enc.encode(String(a)); b = enc.encode(String(b)); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || "https://solomonyelcin.github.io";
    const cors = { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method === "GET") return json({ ok: true, passcode: !!env.PASSCODE }, 200, cors);
    if (req.method !== "POST") return json({ error: "method" }, 405, cors);
    if ((req.headers.get("Origin") || "") !== allowed) return json({ error: "origin", message: "This service only works from the gallery." }, 403, cors);
    if (!env.GEMINI_API_KEY) return json({ error: "config", message: "The edit service has no API key yet." }, 500, cors);

    let b; try { b = await req.json(); } catch { return json({ error: "bad", message: "Bad request." }, 400, cors); }
    if (env.PASSCODE && !same(b.passcode || "", env.PASSCODE)) return json({ error: "passcode", message: "That passcode isn't right." }, 401, cors);
    const prompt = String(b.prompt || "").trim();
    if (!prompt || prompt.length > 500) return json({ error: "prompt", message: "Write a short description of the edit (up to 500 characters)." }, 400, cors);
    const mime = String(b.mimeType || "");
    if (!/^image\/(jpeg|png|webp)$/.test(mime) || typeof b.image !== "string" || b.image.length > 7_000_000) return json({ error: "image", message: "The photo is missing or too large." }, 400, cors);

    // Daily limits, so a leaked passcode can't run up a bill. Needs a KV namespace bound as LIMITS.
    if (env.LIMITS) {
      const day = new Date().toISOString().slice(0, 10), ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const perPerson = +env.DAILY_PER_PERSON || 15, total = +env.DAILY_TOTAL || 150;
      const kp = `ip:${ip}:${day}`, kt = `all:${day}`;
      const [p, t] = await Promise.all([env.LIMITS.get(kp), env.LIMITS.get(kt)]).then((r) => r.map((x) => +x || 0));
      if (t >= total) return json({ error: "limit", message: "The daily edit limit has been reached. Try again tomorrow." }, 429, cors);
      if (p >= perPerson) return json({ error: "limit", message: `You have used your ${perPerson} edits for today. Try again tomorrow.` }, 429, cors);
      await Promise.all([env.LIMITS.put(kp, String(p + 1), { expirationTtl: 172800 }), env.LIMITS.put(kt, String(t + 1), { expirationTtl: 172800 })]);
    }

    const model = env.MODEL || "gemini-2.5-flash-image";
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: b.image } }, { text: `Edit this photo as follows, changing only what is asked and keeping everything else the same: ${prompt}` }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
    } catch { return json({ error: "upstream", message: "Couldn't reach the AI service. Try again." }, 502, cors); }
    if (!r.ok) {
      const status = r.status === 429 ? 429 : 502;
      return json({ error: "upstream", message: r.status === 429 ? "The AI service is busy. Try again in a minute." : "The AI service couldn't process that. Try a different description." }, status, cors);
    }
    const data = await r.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => (p.inlineData || p.inline_data)?.data);
    const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
    if (!img) return json({ error: "refused", message: text || "The AI couldn't make that edit. Try describing it differently." }, 422, cors);
    const d = img.inlineData || img.inline_data;
    return json({ image: d.data, mimeType: d.mimeType || d.mime_type || "image/png", text }, 200, cors);
  },
};
