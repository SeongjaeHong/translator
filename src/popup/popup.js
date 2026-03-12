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

function setStatusMessage(message = "", tone = "neutral") {
  statusMessage.textContent = message;

  if (message) {
    statusMessage.dataset.tone = tone;
    return;
  }

  delete statusMessage.dataset.tone;
}

function getUserFacingActionError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (message === "content-script-unavailable") {
    return "This tab cannot be translated.";
  }

  if (message && message !== "Error") {
    return message;
  }

  return "Unable to communicate with this page.";
}

function buildStatusFromState(state) {
  if (state?.lastError) {
    return {
      message: state.lastError,
      tone: "error"
    };
  }

  if (state?.inFlightAction) {
    return {
      message: "Translation in progress...",
      tone: "neutral"
    };
  }

  return {
    message: state?.isTranslated ? "Page is translated." : "",
    tone: "neutral"
  };
}

function isRestrictedTabUrl(url) {
  if (!url || typeof url !== "string") {
    return true;
  }

  return /^(chrome|edge|about|devtools|view-source):/u.test(url);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureContentScriptLoaded(tabId) {
  if (!tabId) {
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_PAGE_TRANSLATION_STATE_REQUESTED
    });
    return true;
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/shared/runtime-shared.js", "src/content/content-script.js"]
      });
      return true;
    } catch (injectionError) {
      return false;
    }
  }
}

async function getPageTranslationState(tab) {
  if (!tab?.id) {
    return { isTranslated: false, lastError: null };
  }

  const isReady = await ensureContentScriptLoaded(tab.id);
  if (!isReady) {
    return {
      isTranslated: false,
      lastError: "This tab cannot be translated."
    };
  }

  try {
    const state = await chrome.tabs.sendMessage(tab.id, {
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

  if (!tab?.id || isRestrictedTabUrl(tab.url)) {
    setActionButtonState(false, false);
    setStatusMessage("This tab cannot be translated.", "error");
    return;
  }

  const state = await getPageTranslationState(tab);
  setActionButtonState(state.isTranslated, true);
  const status = buildStatusFromState(state);
  setStatusMessage(status.message, status.tone);
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
  if (!tab?.id || isRestrictedTabUrl(tab.url)) {
    setStatusMessage("This tab cannot be translated.", "error");
    return;
  }

  setActionButtonState(false, false);
  setStatusMessage("");

  try {
    const isReady = await ensureContentScriptLoaded(tab.id);
    if (!isReady) {
      throw new Error("content-script-unavailable");
    }

    const targetLanguage = await getTargetLanguage();
    const nextState = await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED,
      payload: {
        action: "toggle",
        targetLanguage
      }
    });

    setActionButtonState(Boolean(nextState?.isTranslated), true);
    const status = buildStatusFromState(nextState);
    setStatusMessage(status.message, status.tone);
  } catch (error) {
    setActionButtonState(false, true);
    setStatusMessage(getUserFacingActionError(error), "error");
  }
}

renderTargetLanguageOptions(languageSelect);
loadSettings();
languageSelect.addEventListener("change", saveSettings);
actionButton.addEventListener("click", onActionButtonClicked);
