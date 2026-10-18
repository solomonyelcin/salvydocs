# Drive Gallery

A fast, friendly web viewer for the photos, videos and documents in your Google Drive.
Pure static HTML, CSS and JavaScript, so it hosts for free on GitHub Pages. No server, no build step.

**Features:** folder browsing with breadcrumbs, All Photos / Videos / Documents / Starred views, search (press `/`),
sort, grid and list layouts, dark mode, a full-screen viewer with arrow-key navigation, infinite scroll with lazy-loaded
thumbnails, and caching so going back is instant. Access is **read-only** and your data never leaves your browser.

## 1. Create a Google OAuth client ID (about 3 minutes)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick one).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add yourself under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorized JavaScript origins** add:
   - `https://solomonyelcin.github.io`
   - `http://localhost:8000` (for local testing)
5. Copy the client ID into `config.js` (`CLIENT_ID`).

The client ID is public by design, so it is safe to commit.

## 2. Try it locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## 3. Deploy to GitHub Pages

```bash
git remote add origin https://github.com/solomonyelcin/salvydocs.git
git push -u origin main
```

Then in the repo go to **Settings → Pages → Source: GitHub Actions**. The included workflow
(`.github/workflows/pages.yml`) publishes the site on every push. Your site will be at
`https://solomonyelcin.github.io/salvydocs/`.

## Notes

- The `drive.readonly` scope is a restricted scope. For personal use, keep the app in *Testing* mode with yourself as a test user.
  Google may ask you to re-consent about every 7 days in that mode.
- Videos and documents open in Google's own preview player, so playback is fast and supports every Drive format.
