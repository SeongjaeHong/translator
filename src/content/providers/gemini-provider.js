import { BaseTranslationProvider } from "./base-provider.js";

export class GeminiTranslationProvider extends BaseTranslationProvider {
  constructor(config) {
    super({ providerId: "gemini", config });
  }
}
