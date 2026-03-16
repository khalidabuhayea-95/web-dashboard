# Canva Template Importer (Web Scraping)

This tool scrapes the visible Canva design canvas and imports it into local templates.

## What it does

- Opens a Canva design URL in Playwright Chromium.
- Captures the largest design canvas as PNG.
- Imports it as a new template in the local database.
- Creates one image layer (`Imported Canva Snapshot`) that fills the canvas.

## Requirements

- Local app database configured (`DATABASE_URL` in `.env`/`.env.local`).
- Playwright installed (already added in this repo).
- First run may require login in the opened browser profile.

## Usage

```bash
npm run import:canva -- --url "https://www.canva.com/design/.../edit"
```

Optional flags:

```bash
--name "Template Name"           # override imported name
--slug "template-slug"           # override slug
--owner-id "<uuid>"              # explicit owner (default: latest template owner)
--profile-dir ".tmp/canva-profile" # persistent browser profile dir
--headless                        # run without opening browser UI
--timeout-ms 180000               # wait timeout
--max-dimension 1920              # max width/height; keeps aspect ratio
--snapshot-path ".tmp/canva.png" # save captured image locally
```

## Result

The script prints:

- created template id
- name/slug
- imported canvas size
- source URL
- direct editor URL (`/editor-pro?templateId=...`)

## Dashboard tab

- Open `/canva-import` from the left sidebar (`Canva Import`).
- Paste Canva URL and click `Import from Canva`.
- The dashboard tool calls `/api/tools/canva-import`.
- Import flow:
  - Primary: Playwright canvas scrape in headless/background mode (no new login tab/window).
  - Fallback: HTML preview scrape (`og:image`) if Playwright fails.
- If import fails, the UI now shows backend details (`Playwright import ... | Preview scrape ...`) so you can see the exact block reason.

## Chrome extension mode

- Extension path:
  - `/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/extension/canva-importer`
- Generate token from dashboard `/canva-import` (`Generate extension token`).
- Paste token in extension popup.
- Open Canva tab and click `Import current tab`.
- Extension endpoint:
  - `POST /api/tools/canva-import/extension-import`
- Capture strategy:
  - Primary: extract layer nodes (`[id^="LB"].DF_utQ`) from Canva page and convert to Fabric objects.
  - Secondary: crop visible Canva page frame (`[data-page-id]`) for thumbnail/fallback.
  - Fallback: one flattened image layer if layer extraction is unavailable.

## Notes

- Import is flattened to one image layer (not native Canva editable layers).
- If the canvas is not detected, the script pauses so you can complete login/open the design and continue.
