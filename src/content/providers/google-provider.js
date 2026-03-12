import { BaseTranslationProvider } from "./base-provider.js";

export class GoogleTranslationProvider extends BaseTranslationProvider {
  constructor(config) {
    super({ providerId: "google", config });
  }
}
