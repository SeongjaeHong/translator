import {
  DEFAULT_TARGET_LANGUAGE,
  STORAGE_KEYS,
  SUPPORTED_TARGET_LANGUAGES
} from "./constants.js";

export function renderTargetLanguageOptions(selectElement) {
  for (const language of SUPPORTED_TARGET_LANGUAGES) {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = language.label;
    selectElement.append(option);
  }
}

export async function getTargetLanguage() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.targetLanguage);
  return stored[STORAGE_KEYS.targetLanguage] ?? DEFAULT_TARGET_LANGUAGE;
}

export async function setTargetLanguage(targetLanguage) {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.targetLanguage]: targetLanguage
  });
}
