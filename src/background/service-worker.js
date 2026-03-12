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
  if (info.menuItemId !== CONTEXT_MENU.id || !tab?.id) {
    return;
  }

  const targetLanguage = await getTargetLanguage();

  try {
    const isReady = await ensureContentScriptLoaded(tab.id);
    if (!isReady) {
      throw new Error("content-script-unavailable");
    }

    const nextState = await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED,
      payload: {
        action: "toggle",
        targetLanguage
      }
    });

    await updateContextMenuTitle(Boolean(nextState?.isTranslated));
  } catch (error) {
    await updateContextMenuTitle(false);
  }
});
