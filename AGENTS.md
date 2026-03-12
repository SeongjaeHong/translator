# AGENTS.md

## Project overview
This repository contains a Chrome Extension built with Manifest V3.
The extension adds a context menu item to translate the current page into a user-selected target language.

## Product rules
- Default target language is Korean.
- The user must be able to change the target language from a dropdown UI.
- The extension should attempt to translate multilingual pages comprehensively, not assume a single source language for the whole page.

## Architecture rules
- Use Manifest V3 only.
- Use a service worker for context menu creation and message routing.
- Use content scripts for DOM text extraction and replacement.
- Use chrome.storage for settings persistence.
- Keep the translation provider abstracted behind an interface.

## Security and permissions
- Keep permissions minimal.
- Do not add host permissions broadly unless required.
- Do not commit secrets, API keys, binary files, or generated artifacts.

## Coding rules
- Keep patches minimal and task-focused.
- Prefer editing existing files over adding many new files.
- Do not perform broad refactors unless explicitly asked.

## Validation checklist
Before finishing a task:
1. Confirm manifest.json remains valid.
2. Confirm permissions are still minimal.
3. Confirm the context menu wiring works.
4. Confirm storage reads/writes work.
5. Confirm message passing between service worker and content script works.
6. Summarize changed files and manual test steps.

## Forbidden actions
- Do not commit dist/, build/, node_modules/, .zip, .crx, .pem, .env files.
- Do not add analytics or tracking.
- Do not change MV3 to another manifest version.
