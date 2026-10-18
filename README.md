# Salvius Memories

A fast, friendly public gallery for the photos, videos and documents in one Google Drive folder.
Pure static HTML, CSS and JavaScript hosted on GitHub Pages. Visitors need no account and no Google sign-in.

Live site: https://solomonyelcin.github.io/salvydocs/

## How it works

The page reads the folder with the Google Drive API using a restricted, public API key.
It shows only the folder set in `config.js` (`ROOT_FOLDER_ID`) and its sub-folders.
Nothing else in the Drive is reachable.

## Show a different or an additional folder

1. In Google Drive, right-click the folder → **Share → General access → Anyone with the link → Viewer**.
2. Copy the folder ID from its URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
3. Put it in `ROOT_FOLDER_ID` in `config.js` and commit. Sub-folders of a shared folder are covered automatically.

Anyone with the site address can view and download everything inside a shared folder, so only share what you are happy to make public.

## API key

In Google Cloud Console → **Credentials → Create credentials → API key**, then restrict it:

- **API restrictions:** Google Drive API only
- **Website restrictions:** `https://solomonyelcin.github.io/*`

The key is visible in the page source by design. These restrictions keep other sites from using it.

## Deploy

Pushing to `main` publishes the site through the GitHub Actions workflow (`.github/workflows/pages.yml`).
In the repo, **Settings → Pages → Source** must be **GitHub Actions**.

## Features

Folder browsing with breadcrumbs, filters for Photos / Videos / Documents, search in the current folder (press `/`),
sorting, grid and list layouts, dark mode, a full-screen viewer with arrow-key navigation, infinite scroll with
lazy-loaded thumbnails, and caching so going back is instant.
