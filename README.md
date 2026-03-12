# Multilingual Page Translator

A Chrome extension that translates web pages into a selected language using Chrome’s built-in AI translation APIs.

Unlike typical page translators that assume a single page language, this extension is designed to better handle multilingual pages by translating visible text segments across the page.

## Features

- Translate the current page into a selected target language
- Restore the original page text instantly
- Works with Chrome built-in Translator API
- Handles multilingual pages by processing visible text segments
- Supports translation from the popup or right-click context menu
- Fast re-translation using cached results

## Installation (Development)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension project folder

## Usage

### Popup method

1. Click the extension icon
2. Choose the target language
3. Click **Translate Page**

### Context menu method

1. Right-click anywhere on the page
2. Click **Translate Page**

### Restore original text

- After translation, the action changes to **Restore Original**
- Clicking it restores the original page text instantly

## Requirements

- Chrome desktop
- A recent Chrome version that supports built-in AI APIs

No API keys or external translation services are required.

## Technical overview

- Manifest V3 extension
- Service worker for background logic and context menus
- Content script for DOM text extraction and replacement
- Chrome built-in Language Detector API for language detection
- Chrome built-in Translator API for translation

Translation pipeline:

`DOM extraction → language detection → translation → DOM replacement`

## Limitations

- Works only in Chrome desktop
- Some UI text or very short fragments may not be translated
- Extremely dynamic pages may require re-running translation

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file.
