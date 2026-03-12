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
  return isTranslated ? "Restore Original" : "Translate Page";
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
    return "Translation unavailable";
  }

  if (message && message !== "Error") {
    return message;
  }

  return "Translation unavailable";
}

function buildStatusFromState(state, targetLanguageLabel = "") {
  if (state?.lastError) {
    return {
      message: "Translation unavailable",
      tone: "error"
    };
  }

  if (state?.isTranslated) {
    return {
      message: `Translated to ${targetLanguageLabel || "selected language"}`,
      tone: "neutral"
    };
  }

  return {
    message: "Ready to translate",
    tone: "neutral"
  };
}

function getSelectedLanguageLabel() {
  const selectedOption = languageSelect.selectedOptions?.[0];
  return selectedOption?.textContent?.trim() ?? "";
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
      lastError: "Translation unavailable"
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

function setActionButtonState(isTranslated, isEnabled = true, isLoading = false) {
  actionButton.textContent = isLoading ? "Translating…" : getActionLabel(isTranslated);
  actionButton.disabled = !isEnabled;
}

async function refreshActionButton() {
  const tab = await getActiveTab();

  if (!tab?.id || isRestrictedTabUrl(tab.url)) {
    setActionButtonState(false, false);
    setStatusMessage("Translation unavailable", "error");
    return;
  }

  const state = await getPageTranslationState(tab);
  setActionButtonState(state.isTranslated, true);
  const status = buildStatusFromState(state, getSelectedLanguageLabel());
  setStatusMessage(status.message, status.tone);
}

async function loadSettings() {
  languageSelect.value = await getTargetLanguage();
  await refreshActionButton();
}

async function saveSettings() {
  await setTargetLanguage(languageSelect.value);

  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedTabUrl(tab.url)) {
    return;
  }

  const state = await getPageTranslationState(tab);
  const status = buildStatusFromState(state, getSelectedLanguageLabel());
  setStatusMessage(status.message, status.tone);
}

async function onActionButtonClicked() {
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedTabUrl(tab.url)) {
    setStatusMessage("Translation unavailable", "error");
    return;
  }

  setActionButtonState(false, false, true);

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

    const isTranslated = Boolean(nextState?.isTranslated);
    setActionButtonState(isTranslated, true);

    if (nextState?.lastError) {
      setStatusMessage("Translation unavailable", "error");
      return;
    }

    const nextStatus = isTranslated
      ? `Translated to ${getSelectedLanguageLabel() || "selected language"}`
      : "Original restored";
    setStatusMessage(nextStatus, "neutral");
  } catch (error) {
    setActionButtonState(false, true);
    setStatusMessage(getUserFacingActionError(error), "error");
  }
}

renderTargetLanguageOptions(languageSelect);
loadSettings();
languageSelect.addEventListener("change", saveSettings);
actionButton.addEventListener("click", onActionButtonClicked);
