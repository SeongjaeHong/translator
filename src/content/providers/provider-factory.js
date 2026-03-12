import { ChromeBuiltInTranslationProvider } from "./chrome-built-in-provider.js";

export function createTranslationProvider() {
  return new ChromeBuiltInTranslationProvider();
}
