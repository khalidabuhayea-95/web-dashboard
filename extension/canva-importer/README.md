# Canva Importer Extension

This extension captures the active Canva design tab and sends it to your dashboard import endpoint.

## Load extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:
   - `/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/extension/canva-importer`

## Setup

1. Open dashboard page `/canva-import`.
2. Click `Generate extension token`.
3. Copy token and paste it into extension popup.
4. Set dashboard URL to your running dev server (for example `http://localhost:3000`).
   - `http://127.0.0.1:<port>` is also supported.

## Import flow

1. Open Canva design tab in Chrome.
2. Click extension icon.
3. Click `Import current tab`.

The extension extracts Canva layer nodes (`[id^=\"LB\"].DF_utQ`) and posts a Fabric layer list to:

- `POST /api/tools/canva-import/extension-import`

If you update extension files, click `Reload` for the extension in `chrome://extensions` before testing again.
If you update `manifest.json`, reloading the extension is required for permission changes to take effect.

Notes:

- Text and image items are imported as separate layers.
- When a layer source is blocked/temporary, importer falls back to image-based handling for that item.
- Extension logger is enabled in both popup and background worker:
  - Structured logs are written to browser console.
  - Unhandled exceptions and unhandled promise rejections are captured automatically.
  - Recent logs are persisted in `chrome.storage.local` key `canva_importer_logs_v1`.
  - For debugging in popup DevTools console:
    - `await getCanvaImporterLogs()`
    - `await clearCanvaImporterLogs()`
