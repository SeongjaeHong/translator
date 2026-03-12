# Page Translator (Chrome Extension, MV3)

A minimal Manifest V3 Chrome Extension scaffold for translating the current page into a user-selected target language.

## Current scaffold

- MV3 manifest with minimal permissions.
- Background service worker that:
  - Creates a `Translate page` context menu item.
  - Initializes default target language to Korean (`ko`).
  - Initializes provider settings with Google as the default translation provider.
  - Sends translation action messages to the content script.
- Content script that:
  - Extracts translatable DOM text segments.
  - Routes translation through a provider abstraction (Google/OpenAI/Gemini).
  - Detects language per extracted segment (placeholder logic for now).
  - Supports restore to original page text.
- Options page with:
  - Target language dropdown persisted in `chrome.storage.sync`.
  - Translation provider dropdown persisted in `chrome.storage.sync`.
- Shared constants/message types/settings models for clean wiring.

> External API calls are intentionally not implemented yet. The architecture is provider-ready.

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
    │       ├── gemini-provider.js
    │       ├── google-provider.js
    │       ├── openai-provider.js
    │       └── provider-factory.js
    ├── options
    │   ├── options.css
    │   ├── options.html
    │   └── options.js
    └── shared
        ├── constants.js
        ├── messages.js
        ├── provider-settings.js
        ├── providers.js
        └── target-language.js
```

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Manual sanity checks

1. Right-click a page and confirm `Translate page` is present.
2. Open extension options and change target language and provider.
3. Refresh options and confirm language/provider selections persist.
4. Click `Translate page` and confirm translated text updates and restore works.

## Notes

- Permissions are intentionally minimal: `contextMenus`, `storage`, `scripting`, `activeTab`.
- No secrets, generated artifacts, or build outputs are included.
