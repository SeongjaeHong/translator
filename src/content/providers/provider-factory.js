import {
  DEFAULT_TRANSLATION_PROVIDER,
  TRANSLATION_PROVIDER_IDS,
  normalizeProviderId
} from "../../shared/providers.js";
import { GeminiTranslationProvider } from "./gemini-provider.js";
import { GoogleTranslationProvider } from "./google-provider.js";
import { OpenAiTranslationProvider } from "./openai-provider.js";

export function createTranslationProvider(providerId, providerConfig) {
  const normalizedProviderId = normalizeProviderId(providerId);

  if (normalizedProviderId === TRANSLATION_PROVIDER_IDS.OPENAI) {
    return new OpenAiTranslationProvider(
      providerConfig?.providers?.[TRANSLATION_PROVIDER_IDS.OPENAI]
    );
  }

  if (normalizedProviderId === TRANSLATION_PROVIDER_IDS.GEMINI) {
    return new GeminiTranslationProvider(
      providerConfig?.providers?.[TRANSLATION_PROVIDER_IDS.GEMINI]
    );
  }

  return new GoogleTranslationProvider(
    providerConfig?.providers?.[DEFAULT_TRANSLATION_PROVIDER]
  );
}
