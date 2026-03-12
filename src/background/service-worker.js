import { CONTEXT_MENU, DEFAULT_TARGET_LANGUAGE, STORAGE_KEYS } from "../shared/constants.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

async function getTargetLanguage() {
  const { [STORAGE_KEYS.targetLanguage]: targetLanguage = DEFAULT_TARGET_LANGUAGE } =
    await chrome.storage.sync.get(STORAGE_KEYS.targetLanguage);

  return targetLanguage;
}

async function updateContextMenuTitle(isTranslated) {
  const nextTitle = isTranslated ? CONTEXT_MENU.titleRestore : CONTEXT_MENU.titleTranslate;

  await chrome.contextMenus.update(CONTEXT_MENU.id, { title: nextTitle });
}

async function ensureContextMenu() {
  try {
    await chrome.contextMenus.create({
      id: CONTEXT_MENU.id,
      title: CONTEXT_MENU.titleTranslate,
      contexts: ["page"]
    });
  } catch (error) {
    // Ignore duplicate id errors when the service worker restarts.
    if (!String(error?.message ?? "").includes("Cannot create item with duplicate id")) {
      throw error;
    }
  }
}

async function ensureTargetLanguageDefault() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.targetLanguage);
  if (!stored[STORAGE_KEYS.targetLanguage]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.targetLanguage]: DEFAULT_TARGET_LANGUAGE
    });
  }
}

async function ensureContentScriptLoaded(tabId) {
  if (!tabId) {
    console.warn("[Page Translator][ContextMenu] Missing tab id for content script readiness check");
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_PAGE_TRANSLATION_STATE_REQUESTED
    });
    return true;
  } catch (error) {
    console.info("[Page Translator][ContextMenu] Content script not reachable; attempting injection", {
      tabId,
      error: error instanceof Error ? error.message : String(error)
    });

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/shared/runtime-shared.js", "src/content/content-script.js"]
      });

      console.info("[Page Translator][ContextMenu] Content script injected", { tabId });
      return true;
    } catch (injectionError) {
      console.error("[Page Translator][ContextMenu] Failed to inject content script", {
        tabId,
        error: injectionError instanceof Error ? injectionError.message : String(injectionError)
      });

      return false;
    }
  }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function setContextMenuErrorState(tabId, errorMessage) {
  console.error("[Page Translator][ContextMenu] Translation action failed", {
    tabId,
    error: errorMessage
  });

  await chrome.action.setBadgeBackgroundColor({ color: "#B00020" });
  await chrome.action.setBadgeText({ text: "ERR" });
  await chrome.action.setTitle({
    title: `Page Translator: ${errorMessage}`
  });
}

async function clearContextMenuErrorState() {
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "Page Translator" });
}

async function runTranslationAction(tabId, targetLanguage) {
  const resolvedTabId = tabId ?? (await getActiveTabId());

  if (!resolvedTabId) {
    throw new Error("Unable to identify an active tab for translation.");
  }

  const isReady = await ensureContentScriptLoaded(resolvedTabId);
  if (!isReady) {
    throw new Error("This tab cannot be translated because the content script is unavailable.");
  }

  const nextState = await chrome.tabs.sendMessage(resolvedTabId, {
    type: MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED,
    payload: {
      action: "toggle",
      targetLanguage
    }
  });

  if (nextState?.lastError) {
    throw new Error(nextState.lastError);
  }

  return nextState;
}

async function getPageTranslationState(tabId) {
  if (!tabId) {
    return { isTranslated: false };
  }

  const isReady = await ensureContentScriptLoaded(tabId);
  if (!isReady) {
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
    // Some pages cannot receive messages (e.g. chrome:// URLs).
  }

  return { isTranslated: false };
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureContextMenu();
  await ensureTargetLanguageDefault();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureContextMenu();
});

void ensureContextMenu();

if (chrome.contextMenus?.onShown?.addListener) {
  chrome.contextMenus.onShown.addListener(async (info, tab) => {
    if (!info.contexts.includes("page")) {
      return;
    }

    const state = await getPageTranslationState(tab?.id);
    await updateContextMenuTitle(state.isTranslated);
    chrome.contextMenus.refresh();
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU.id) {
    return;
  }

  const targetLanguage = await getTargetLanguage();

  try {
    const nextState = await runTranslationAction(tab?.id, targetLanguage);
    await clearContextMenuErrorState();
    await updateContextMenuTitle(Boolean(nextState?.isTranslated));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unable to communicate with this page.";

    await setContextMenuErrorState(tab?.id, errorMessage);
    await updateContextMenuTitle(false);
  }
});
