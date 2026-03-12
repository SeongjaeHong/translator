import { MESSAGE_TYPES } from "../shared/messages.js";
import {
  getTargetLanguage,
  renderTargetLanguageOptions,
  setTargetLanguage
} from "../shared/target-language.js";

const languageSelect = document.querySelector("#target-language");
const actionButton = document.querySelector("#translate-action");
const statusMessage = document.querySelector("#status-message");

function getActionLabel(isTranslated) {
  return isTranslated ? "Restore original" : "Translate page";
}

function setStatusMessage(message = "") {
  statusMessage.textContent = message;
}

function buildStatusFromState(state) {
  if (state?.lastError) {
    return state.lastError;
  }

  if (state?.inFlightAction) {
    return "Translation in progress...";
  }

  return state?.isTranslated ? "Page is translated." : "";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function getPageTranslationState(tabId) {
  if (!tabId) {
    return { isTranslated: false, lastError: null };
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

  return { isTranslated: false, lastError: null };
}

function setActionButtonState(isTranslated, isEnabled = true) {
  actionButton.textContent = getActionLabel(isTranslated);
  actionButton.disabled = !isEnabled;
}

async function refreshActionButton() {
  const tab = await getActiveTab();

  if (!tab?.id) {
    setActionButtonState(false, false);
    setStatusMessage("This tab cannot be translated.");
    return;
  }

  const state = await getPageTranslationState(tab.id);
  setActionButtonState(state.isTranslated, true);
  setStatusMessage(buildStatusFromState(state));
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
  setStatusMessage("");

  try {
    const targetLanguage = await getTargetLanguage();
    const nextState = await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED,
      payload: {
        action: "toggle",
        targetLanguage
      }
    });

    setActionButtonState(Boolean(nextState?.isTranslated), true);
    setStatusMessage(buildStatusFromState(nextState));
  } catch (error) {
    setActionButtonState(false, true);
    setStatusMessage("Unable to communicate with this page.");
  }
}

renderTargetLanguageOptions(languageSelect);
loadSettings();
languageSelect.addEventListener("change", saveSettings);
actionButton.addEventListener("click", onActionButtonClicked);
