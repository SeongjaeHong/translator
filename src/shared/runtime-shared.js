(function initPageTranslatorShared(globalScope) {
  if (globalScope.__PAGE_TRANSLATOR_SHARED__) {
    return;
  }

  const shared = {
    DEFAULT_TARGET_LANGUAGE: "ko",
    MESSAGE_TYPES: {
      GET_PAGE_TRANSLATION_STATE_REQUESTED: "GET_PAGE_TRANSLATION_STATE_REQUESTED",
      PAGE_TRANSLATION_ACTION_REQUESTED: "PAGE_TRANSLATION_ACTION_REQUESTED"
    }
  };

  Object.defineProperty(globalScope, "__PAGE_TRANSLATOR_SHARED__", {
    value: Object.freeze(shared),
    writable: false,
    configurable: false
  });
})(globalThis);
