import { CONTEXT_MENU, DEFAULT_TARGET_LANGUAGE, STORAGE_KEYS } from "../shared/constants.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU.id,
    title: CONTEXT_MENU.title,
    contexts: ["page"]
  });

  const stored = await chrome.storage.sync.get(STORAGE_KEYS.targetLanguage);
  if (!stored[STORAGE_KEYS.targetLanguage]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.targetLanguage]: DEFAULT_TARGET_LANGUAGE
    });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU.id || !tab?.id) {
    return;
  }

  const { [STORAGE_KEYS.targetLanguage]: targetLanguage = DEFAULT_TARGET_LANGUAGE } =
    await chrome.storage.sync.get(STORAGE_KEYS.targetLanguage);

  chrome.tabs.sendMessage(tab.id, {
    type: MESSAGE_TYPES.TRANSLATE_PAGE_REQUESTED,
    payload: { targetLanguage }
  });
});
