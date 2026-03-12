# Page Translator (Chrome Extension, MV3)

A Manifest V3 Chrome extension MVP that translates text on the current page into a user-selected target language using Chrome built-in AI translation APIs when they are available.

## Project purpose

This project is a minimal, user-focused MVP for in-browser page translation:

- Trigger translation from a **page context menu** or the **extension popup**.
- Persist a selected target language with `chrome.storage.sync`.
- Translate page text in DOM text segments, then allow restoring original text.
- Keep implementation aligned with MV3 patterns (service worker + content script).

## Current MVP features

- **MV3 architecture**
  - Service worker creates and manages the context menu.
  - Content script extracts and updates text nodes on the page.
- **Translation actions**
  - Context menu action: **Translate page** / **Restore original** (toggle behavior).
  - Popup action button with the same translate/restore toggle behavior.
- **Target language settings**
  - Default target language is **Korean (`ko`)**.
  - Target language can be changed from:
    - extension popup dropdown
    - options page dropdown
  - Selected value is persisted in `chrome.storage.sync`.
- **Built-in provider approach**
  - Uses Chrome built-in `LanguageDetector` API for per-segment detection.
  - Uses Chrome built-in `Translator` API for translation.
  - Groups segments by detected source language before translation.
- **Fallback behavior**
  - If required built-in APIs are missing/unavailable, translation is skipped and an error/status is surfaced.

## Supported environment requirements

This MVP currently targets:

- **Google Chrome** with Manifest V3 extension support.
- A Chrome environment where built-in AI APIs used by this project are available to extensions/content scripts:
  - `LanguageDetector`
  - `Translator`

If those APIs are not available in your Chrome channel/configuration, the extension still loads, but page translation will not complete successfully.

## Install and load unpacked extension in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this repository folder (`/workspace/translator` or your cloned local path).
5. Confirm the extension appears as **Page Translator**.

## How to use the context menu

1. Open a normal web page (not a restricted browser page like `chrome://...`).
2. Right-click anywhere on the page.
3. Click **Translate page**.
4. Wait for translation to finish.
5. Right-click again and click **Restore original** to revert translated text.

Notes:
- The menu title is updated dynamically based on current page translation state.
- If translation fails (for example unsupported built-in APIs), the menu is reset to **Translate page**.

## How to use the popup

1. Click the extension toolbar icon to open the popup.
2. Confirm/select **Target language**.
3. Click **Translate page**.
4. After translation, the button label changes to **Restore original**.
5. Click **Restore original** to revert text changes.

Popup status messages indicate in-progress state and basic error conditions (for example, tabs that cannot be messaged).

## How to change target language

You can change target language in either location:

- **Popup**: use the target language dropdown.
- **Options page**: open extension options and use the same dropdown.

Supported target language choices in the current MVP:

- Korean (`ko`) — default
- English (`en`)
- German (`de`)
- French (`fr`)
- Spanish (`es`)

The selected value is saved in `chrome.storage.sync` and reused by both context menu and popup translation actions.

## How translate/restore currently works

### Translate flow (current implementation)

- Content script collects translatable text segments from the page DOM.
- The provider checks built-in API availability.
- Segment languages are detected (best-effort, per segment).
- Segments are translated in small batches by source-language group.
- Translated text is written back to corresponding DOM text nodes.
- Internal page state tracks whether content is currently translated.

### Restore flow (current implementation)

- Original node text snapshots from the last translation pass are kept in memory.
- Restore rewrites those original values back to the same nodes.
- State is reset to untranslated.

Important: restore applies to the most recent translation operation in the current page session.

## Multilingual segment-based translation (concept)

This MVP does **not** assume a single source language for the whole page.

Instead, it:

- Detects language per extracted text segment.
- Groups segments by detected source language.
- Creates translator instances per source→target language pair.
- Translates each group in bounded batches.

This approach is intended to handle mixed-language pages more safely than page-level single-language assumptions, while still being lightweight for an MVP.

## Behavior when built-in APIs are unsupported

When `LanguageDetector` and/or `Translator` are unavailable or not ready:

- The extension UI still loads.
- Translation requests fail gracefully.
- The page remains unchanged (or is restored if already translated before a new attempt).
- A user-visible status/error message is returned from the content-script state path.

No external translation service fallback is currently implemented.

## Known limitations

- Relies on Chrome built-in AI translation APIs; availability depends on Chrome version/channel/configuration.
- Not all tabs/pages are translatable (for example browser internal pages where messaging/content scripts are restricted).
- Translation quality and language detection confidence depend on built-in model behavior.
- Some text may be intentionally skipped (for example trivial/very short segments or unsupported cases).
- DOM mutations after translation are not continuously re-translated in real time.
- Restore is based on in-memory snapshots from the last translation cycle in the current page context.

## Permissions and security notes

- Permissions are intentionally minimal: `contextMenus`, `storage`, `activeTab`.
- No bundled secrets, API keys, or tracking/analytics.
- Manifest version remains **MV3**.
