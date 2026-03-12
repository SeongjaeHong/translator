import {
  DEFAULT_TARGET_LANGUAGE,
  STORAGE_KEYS,
  SUPPORTED_TARGET_LANGUAGES
} from "../shared/constants.js";

const languageSelect = document.querySelector("#target-language");
const status = document.querySelector("#status");

function renderLanguageOptions() {
  for (const language of SUPPORTED_TARGET_LANGUAGES) {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = language.label;
    languageSelect.append(option);
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.targetLanguage);
  const selectedLanguage =
    stored[STORAGE_KEYS.targetLanguage] ?? DEFAULT_TARGET_LANGUAGE;

  languageSelect.value = selectedLanguage;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.targetLanguage]: languageSelect.value
  });

  status.textContent = "Saved.";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1200);
}

renderLanguageOptions();
loadSettings();
languageSelect.addEventListener("change", saveSettings);
