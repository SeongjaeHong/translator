# Page Translator (Chrome Extension, MV3)

A minimal Manifest V3 Chrome Extension scaffold for translating the current page into a user-selected target language.

## Current scaffold

- MV3 manifest with minimal permissions.
- Background service worker that:
  - Creates a `Translate page` context menu item.
  - Initializes default target language to Korean (`ko`).
  - Sends translation action messages to the content script.
- Content script that:
  - Extracts translatable DOM text segments.
  - Uses Chrome built-in Language Detector API per segment.
  - Uses Chrome built-in Translator API by source-language groups and small batches.
  - Supports restore to original page text.
  - Gracefully skips translation when built-in AI APIs are unavailable.
- Options page with:
  - Target language dropdown persisted in `chrome.storage.sync`.

## Project structure

```text
.
├── manifest.json
└── src
    ├── background
    │   └── service-worker.js
    ├── content
    │   ├── content-script.js
    │   └── providers
    │       ├── base-provider.js
    │       ├── batching.js
    │       ├── chrome-built-in-provider.js
    │       └── provider-factory.js
    ├── options
    │   ├── options.css
    │   ├── options.html
    │   └── options.js
    └── shared
        ├── constants.js
        ├── messages.js
        └── target-language.js
```

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Manual sanity checks

1. Right-click a page and confirm `Translate page` is present.
2. Open extension options and change target language.
3. Refresh options and confirm language selection persists.
4. Click `Translate page` and confirm translated text updates and restore works.

## Notes

- Permissions are intentionally minimal: `contextMenus`, `storage`, `activeTab`.
- No secrets, generated artifacts, or build outputs are included.
