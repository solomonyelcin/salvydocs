# Salvius Memories

A fast, friendly public gallery for the photos, videos and documents in one Google Drive folder.
Pure static HTML, CSS and JavaScript hosted on GitHub Pages. Visitors need no account and no Google sign-in.

Live site: https://solomonyelcin.github.io/salvydocs/

## What visitors can do

- **Browse** albums (sub-folders) with breadcrumbs. Photos are grouped by month in a mosaic, documents are listed as rows.
- **Smart search**: type what is in a photo (for example `cat` or `beach`) and photos that look like it are found, even if the file name says nothing. The first smart search downloads a small AI model (about 60 MB, once). Photos are indexed automatically on every deploy and nightly; the set-up is in *Smart search* below.
- **Search** by name or date (for example `september` or `2026`). Search this album, or switch to **Everywhere** to search every album. Press `/` to jump to the search box.
- **Group by** day, month, year, **events** (photos taken close together), **places** (from the photo's location, named by city), **themes** (beach, food, pets and so on, found by the AI scan) or **your own groups**. Open the sliders button and choose *Group by*.
- **Filter and sort** by type (Photos, Videos, Documents, Albums), by date (last 7 or 30 days, last 12 months, or a year), and by newest, oldest or name. Choose Mosaic, Grid or List layout and the thumbnail size.
- **View** photos fitted to any screen, with zoom in/out/fit buttons (also wheel, double-click, double-tap or pinch), drag to pan, swipe or arrow keys to move on, a filmstrip, a details panel and a slideshow. **Videos** play in a built-in player (seek bar, speed, volume, loop, picture-in-picture, full screen, double-tap to skip 10 s). Videos the browser can't play, and documents, open in Google's own preview.
- **Edit with AI**: in the photo viewer, tap the magic wand, describe a change ("remove the background", "make the sky a sunset"), and download the result. The original in Drive is never changed. This needs the small edit service in `worker/` (set-up steps in `worker/README.md`); until then the button is hidden.
- **Download** one file, or turn on **Select** (or long-press a photo on a phone), pick several and download them together. Google Docs, Sheets and Slides download as PDF, XLSX and PPTX.
- **Share** an album or a single photo. Every view has its own link, and the Back button works as expected. On phones, Share opens the system share sheet.
- Works on phones, tablets and desktops, in light and dark themes, with keyboard support.

Keyboard in the viewer: arrows move (or pan when zoomed in), `I` details, `P` slideshow, `D` download, `F` full screen, `+` `-` `0` zoom, `Esc` closes.
Video: `Space` play/pause, `←` `→` seek 5 s, `J` `L` seek 10 s, `↑` `↓` volume, `M` mute, `<` `>` speed, `R` loop, `PageUp`/`PageDown` previous/next file.

## How it works

The page reads the folder with the Google Drive API using a restricted, public API key.
It shows only the folder set in `config.js` (`ROOT_FOLDER_ID`) and its sub-folders. Links to anything outside it are ignored.
Folders are loaded once and searched in the browser, so filtering and searching are instant.

## Show a different or an additional folder

1. In Google Drive, right-click the folder, then **Share → General access → Anyone with the link → Viewer**.
2. Copy the folder ID from its URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
3. Put it in `ROOT_FOLDER_ID` in `config.js` and commit. Sub-folders of a shared folder are covered automatically.

Anyone with the site address can view and download everything inside a shared folder, so only share what you are happy to make public.

## API key

In Google Cloud Console, go to **Credentials → Create credentials → API key**, then restrict it:

- **API restrictions:** Google Drive API only
- **Website restrictions:** `https://solomonyelcin.github.io/*`

The key is visible in the page source by design. These restrictions keep other sites from using it.

## Deploy

Pushing to `main` publishes the site through the GitHub Actions workflow (`.github/workflows/pages.yml`).
In the repo, **Settings → Pages → Source** must be **GitHub Actions**.

## Settings in `config.js`

- `ROOT_FOLDER_ID`, `ROOT_NAME`: the folder to show and the name displayed as the title.
- `EDIT_API` (optional): address of the AI edit service. Empty hides the Edit button.
- `TAGLINE` (optional): the line under the title on the main page.

## Smart search

`scripts/build-index.mjs` runs in the deploy workflow. It reads every photo in the shared folder, turns each into a small vector with the CLIP model (`Xenova/clip-vit-base-patch32`) and publishes `search-index.json` next to the site. Photos that have not changed are reused, so later runs are quick. A nightly run (and any push) picks up new photos.
In the browser, `ai.js` turns the words typed into a vector with the same model and ranks the photos by similarity. If no index exists yet, search falls back to names and dates.
The script sends the site address as the referrer, so the existing restricted API key works and no extra secret is needed.
Run the **Deploy to GitHub Pages** workflow by hand from the Actions tab to index new photos straight away.

## Your own groups (people, occasions)

Edit `groups.json` in the repo to make groups such as a person or an occasion. A photo goes into the first group that matches it. Each group can use any of these:

```json
{
  "groups": [
    { "name": "Grandma", "files": ["<file id>", "<file id>"] },
    { "name": "Wedding 2025", "folders": ["<album folder id>"] },
    { "name": "Diwali", "match": ["diwali", "deepavali"] }
  ]
}
```

- `files`: Drive file IDs (the part after `/file/d/` in a file's link).
- `folders`: album IDs (the part after `/folders/` in an album's link). Everything inside is included.
- `match`: words that appear in the file name.

Then choose *Group by, My groups*. Faces are never scanned, so people groups are the ones you name yourself.
