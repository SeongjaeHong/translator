import { MESSAGE_TYPES } from "../shared/messages.js";
import {
  getTargetLanguage,
  renderTargetLanguageOptions,
  setTargetLanguage
} from "../shared/target-language.js";
import { getProviderConfig, getSelectedProvider } from "../shared/provider-settings.js";

const languageSelect = document.querySelector("#target-language");
const actionButton = document.querySelector("#translate-action");

function getActionFromState(isTranslated) {
  return isTranslated ? "restore" : "translate";
}

function getActionLabel(isTranslated) {
  return isTranslated ? "Restore original" : "Translate page";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function getPageTranslationState(tabId) {
  if (!tabId) {
    return { isTranslated: false };
  }

  try {
    const state = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_PAGE_TRANSLATION_STATE_REQUESTED
    });

    if (typeof state?.isTranslated === "boolean") {
      return state;
    }
  } catch (error) {
    // Some tabs cannot receive messages (e.g. chrome:// pages).
  }

  return { isTranslated: false };
}

function setActionButtonState(isTranslated, isEnabled = true) {
  actionButton.textContent = getActionLabel(isTranslated);
  actionButton.disabled = !isEnabled;
}

async function refreshActionButton() {
  const tab = await getActiveTab();

  if (!tab?.id) {
    setActionButtonState(false, false);
    return;
  }

  const state = await getPageTranslationState(tab.id);
  setActionButtonState(state.isTranslated, true);
}

async function loadSettings() {
  languageSelect.value = await getTargetLanguage();
  await refreshActionButton();
}

async function saveSettings() {
  await setTargetLanguage(languageSelect.value);
}

async function onActionButtonClicked() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  setActionButtonState(false, false);

  try {
    const state = await getPageTranslationState(tab.id);
    const targetLanguage = await getTargetLanguage();
    const action = getActionFromState(state.isTranslated);
    const providerId = await getSelectedProvider();
    const providerConfig = await getProviderConfig();

    const nextState = await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED,
      payload: {
        action,
        targetLanguage,
        providerId,
        providerConfig
      }
    });

    setActionButtonState(Boolean(nextState?.isTranslated), true);
  } catch (error) {
    setActionButtonState(false, true);
  }
}

renderTargetLanguageOptions(languageSelect);
loadSettings();
languageSelect.addEventListener("change", saveSettings);
actionButton.addEventListener("click", onActionButtonClicked);
