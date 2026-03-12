import { MESSAGE_TYPES } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== MESSAGE_TYPES.TRANSLATE_PAGE_REQUESTED) {
    return;
  }

  const language = message.payload?.targetLanguage ?? "ko";

  // Placeholder for a future translation pipeline.
  console.info(`[Page Translator] Translation requested for target language: ${language}`);
});
