# AI edit service

The gallery's **Edit with AI** button sends a photo and a short description to this small Cloudflare Worker.
The Worker holds the Gemini API key (so it never appears on the public site), checks a passcode and daily limits, and returns the edited photo.
Edits are made on a copy; the original in Google Drive is never changed.

## Set up (about 10 minutes, free to start)

1. **Gemini API key.** Go to https://aistudio.google.com/apikey and create a key. Image editing has a small free allowance, then is billed per image. Check current pricing there.
2. **Cloudflare account.** Sign up free at https://dash.cloudflare.com.
3. **Deploy.** On a computer with Node installed, in this `worker` folder:
   ```
   npx wrangler login
   npx wrangler kv namespace create LIMITS
   ```
   Copy the namespace `id` it prints into `wrangler.toml` (remove the `#` on the three `kv_namespaces` lines). Then:
   ```
   npx wrangler secret put GEMINI_API_KEY      (paste your key)
   npx wrangler secret put PASSCODE            (choose a passcode to share with family)
   npx wrangler deploy
   ```
   Wrangler prints the Worker's address, like `https://salvydocs-edit.<you>.workers.dev`.
4. **Tell the gallery.** Put that address in `config.js` as `EDIT_API`, commit, and the **Edit** button (a magic wand in the photo viewer) appears.

No computer? In the Cloudflare dashboard choose Workers & Pages, Create, Hello World, then Edit code and paste in `worker.js`. Add `GEMINI_API_KEY` and `PASSCODE` as secrets, `ALLOWED_ORIGIN` as a variable, and bind a KV namespace named `LIMITS` under Settings.

## Safety

- Only requests from `ALLOWED_ORIGIN` (the gallery) are accepted, and the passcode is required if you set one.
- `DAILY_PER_PERSON` (default 15) and `DAILY_TOTAL` (default 150) cap the cost. Lower them in `wrangler.toml` to spend less.
- Also set a spending limit on your Gemini key in Google AI Studio or Cloud Console.
- Remove the passcode (delete the `PASSCODE` secret) to let anyone use it, within the daily limits.

`MODEL` defaults to `gemini-2.5-flash-image`. Set it in `wrangler.toml` to use a newer Google image-editing model.
