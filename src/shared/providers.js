export const TRANSLATION_PROVIDER_IDS = {
  GOOGLE: "google",
  OPENAI: "openai",
  GEMINI: "gemini"
};

export const DEFAULT_TRANSLATION_PROVIDER = TRANSLATION_PROVIDER_IDS.GOOGLE;

export const SUPPORTED_TRANSLATION_PROVIDERS = [
  {
    id: TRANSLATION_PROVIDER_IDS.GOOGLE,
    label: "Google Translate API"
  },
  {
    id: TRANSLATION_PROVIDER_IDS.OPENAI,
    label: "OpenAI API"
  },
  {
    id: TRANSLATION_PROVIDER_IDS.GEMINI,
    label: "Gemini API"
  }
];

export function createDefaultProviderConfig() {
  return {
    selectedProvider: DEFAULT_TRANSLATION_PROVIDER,
    providers: {
      [TRANSLATION_PROVIDER_IDS.GOOGLE]: {
        apiKey: "",
        endpoint: ""
      },
      [TRANSLATION_PROVIDER_IDS.OPENAI]: {
        apiKey: "",
        endpoint: "",
        model: "gpt-4.1-mini"
      },
      [TRANSLATION_PROVIDER_IDS.GEMINI]: {
        apiKey: "",
        endpoint: "",
        model: "gemini-1.5-flash"
      }
    }
  };
}

export function normalizeProviderId(providerId) {
  const isSupported = SUPPORTED_TRANSLATION_PROVIDERS.some(
    (provider) => provider.id === providerId
  );

  return isSupported ? providerId : DEFAULT_TRANSLATION_PROVIDER;
}
