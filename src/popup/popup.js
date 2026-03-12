import {
  getTargetLanguage,
  renderTargetLanguageOptions,
  setTargetLanguage
} from "../shared/target-language.js";

const languageSelect = document.querySelector("#target-language");

async function loadSettings() {
  languageSelect.value = await getTargetLanguage();
}

async function saveSettings() {
  await setTargetLanguage(languageSelect.value);
}

renderTargetLanguageOptions(languageSelect);
loadSettings();
languageSelect.addEventListener("change", saveSettings);
