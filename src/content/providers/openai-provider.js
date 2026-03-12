import { BaseTranslationProvider } from "./base-provider.js";

export class OpenAiTranslationProvider extends BaseTranslationProvider {
  constructor(config) {
    super({ providerId: "openai", config });
  }
}
