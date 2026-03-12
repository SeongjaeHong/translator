import {
  getTargetLanguage,
  renderTargetLanguageOptions,
  setTargetLanguage
} from "../shared/target-language.js";

const languageSelect = document.querySelector("#target-language");
const status = document.querySelector("#status");

async function loadSettings() {
  languageSelect.value = await getTargetLanguage();
}

function showSavedStatus() {
  status.textContent = "Saved.";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1200);
}

async function saveTargetLanguageSettings() {
  await setTargetLanguage(languageSelect.value);
  showSavedStatus();
}

renderTargetLanguageOptions(languageSelect);
loadSettings();
languageSelect.addEventListener("change", saveTargetLanguageSettings);
