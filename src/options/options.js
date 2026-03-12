import {
  getTargetLanguage,
  renderTargetLanguageOptions,
  setTargetLanguage
} from "../shared/target-language.js";
import { getSelectedProvider, setSelectedProvider } from "../shared/provider-settings.js";
import { SUPPORTED_TRANSLATION_PROVIDERS } from "../shared/providers.js";

const languageSelect = document.querySelector("#target-language");
const providerSelect = document.querySelector("#translation-provider");
const status = document.querySelector("#status");

function renderProviderOptions(selectElement) {
  for (const provider of SUPPORTED_TRANSLATION_PROVIDERS) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    selectElement.append(option);
  }
}

async function loadSettings() {
  languageSelect.value = await getTargetLanguage();
  providerSelect.value = await getSelectedProvider();
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

async function saveProviderSettings() {
  await setSelectedProvider(providerSelect.value);
  showSavedStatus();
}

renderTargetLanguageOptions(languageSelect);
renderProviderOptions(providerSelect);
loadSettings();
languageSelect.addEventListener("change", saveTargetLanguageSettings);
providerSelect.addEventListener("change", saveProviderSettings);
