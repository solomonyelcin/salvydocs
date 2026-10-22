# Salvius Memories

A fast, friendly public gallery for the photos, videos and documents in one Google Drive folder.
Pure static HTML, CSS and JavaScript hosted on GitHub Pages. Visitors need no account and no Google sign-in.

Live site: https://solomonyelcin.github.io/salvydocs/

## What visitors can do

- **Browse** albums (sub-folders) with breadcrumbs. Photos are grouped by month in a mosaic, documents are listed as rows.
- **Search** by name or date (for example `september` or `2026`). Search this album, or switch to **Everywhere** to search every album. Press `/` to jump to the search box.
- **Filter and sort** by type (Photos, Videos, Documents, Albums), by date (last 7 or 30 days, last 12 months, or a year), and by newest, oldest or name. Choose Mosaic, Grid or List layout and the thumbnail size.
- **View** photos fitted to any screen, with zoom in/out/fit buttons (also wheel, double-click, double-tap or pinch), drag to pan, swipe or arrow keys to move on, a filmstrip, a details panel and a slideshow. **Videos** play in a built-in player (seek bar, speed, volume, loop, picture-in-picture, full screen, double-tap to skip 10 s). Videos the browser can't play, and documents, open in Google's own preview.
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
- `TAGLINE` (optional): the line under the title on the main page.
