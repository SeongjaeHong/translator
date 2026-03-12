# Page Translator (Chrome Extension, MV3)

A minimal Manifest V3 Chrome Extension scaffold for translating the current page into a user-selected target language.

## Current scaffold

- MV3 manifest with minimal permissions.
- Background service worker that:
  - Creates a `Translate page` context menu item.
  - Initializes default target language to Korean (`ko`).
  - Sends a message to the content script when menu is clicked.
- Content script entry point that receives translate requests (placeholder only).
- Options page with target language dropdown persisted in `chrome.storage.sync`.
- Shared constants/message types for clean wiring.

> Translation logic is intentionally not implemented yet.

## Project structure

```text
.
├── manifest.json
└── src
    ├── background
    │   └── service-worker.js
    ├── content
    │   └── content-script.js
    ├── options
    │   ├── options.css
    │   ├── options.html
    │   └── options.js
    └── shared
        ├── constants.js
        └── messages.js
```

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Manual sanity checks

1. Right-click a page and confirm `Translate page` is present.
2. Open extension options and change the target language.
3. Refresh options and confirm language persists.
4. Click `Translate page` and confirm no errors in extension/content logs.

## Notes

- Permissions are intentionally minimal: `contextMenus`, `storage`, `scripting`, `activeTab`.
- No secrets, generated artifacts, or build outputs are included.
