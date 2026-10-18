# CrowdCast — extracted source project

CrowdCast is a static dashboard with desktop web-app installation support. Its desktop icon opens the hosted website in a dedicated app window.

## Install on desktop

1. Publish this whole folder to a static host using **HTTPS**, including `manifest.webmanifest`, `sw.js`, and `icons/`. Keep relative paths intact; subfolder hosting is supported.
2. Open the hosted website in Chrome or Edge.
3. Click **Tətbiqi quraşdır** when the browser offers installation, or use the browser's address-bar install icon / app installation menu.
4. Complete the browser's installation dialog. Enable the desktop shortcut option if offered; otherwise create a desktop shortcut from the browser's app management page.

The installed icon opens the same website from which it was installed. No separate executable or fixed domain is required. Hosting and a production URL must be set up separately. Browser support and shortcut placement vary; browsers without installation support can still use the website normally or create a URL shortcut.

This app requires an internet connection. The service worker forwards requests to the network without adding offline caching. Closing the local development server makes a locally installed copy unavailable. Install from your permanent hosted URL for everyday use.

## Run locally

Python 3 (no packages required):

```bash
python -m http.server 8000
```

Open **http://localhost:8000/**. Do not open `index.html` via `file://` because the extracted JSON is loaded with `fetch()`.

## Structure

- `index.html` — original dashboard HTML structure and third-party script references
- `src/styles.css` — original CSS styles, unchanged in order
- `src/app.js` — original dashboard JavaScript, with embedded-data expression replaced by a global data reference
- `src/bootstrap.js` — initializes external JSON then runs `app.js`
- `data/crowdcast.json` — original embedded operational data, unchanged in values
- `manifest.webmanifest`, `icons/` — app identity, launch URL, and desktop icons
- `src/install.js`, `sw.js` — browser installation and online-only service worker

The original UI depends on Google Fonts, Chart.js CDN, and deck.gl CDN exactly as before. Internet access may be needed for these external resources. The original content still says **CrowdCast**, since the request was to change only the code organization.
