import { STORAGE_KEYS } from "./constants.js";
import {
  createDefaultProviderConfig,
  normalizeProviderId
} from "./providers.js";

function mergeProviderConfig(storedConfig) {
  const defaults = createDefaultProviderConfig();

  return {
    selectedProvider: normalizeProviderId(
      storedConfig?.selectedProvider ?? defaults.selectedProvider
    ),
    providers: {
      ...defaults.providers,
      ...(storedConfig?.providers ?? {})
    }
  };
}

export async function getProviderConfig() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.providerConfig);
  return mergeProviderConfig(stored[STORAGE_KEYS.providerConfig]);
}

export async function ensureProviderConfig() {
  const merged = await getProviderConfig();
  await chrome.storage.sync.set({
    [STORAGE_KEYS.providerConfig]: merged
  });

  return merged;
}

export async function setProviderConfig(providerConfig) {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.providerConfig]: mergeProviderConfig(providerConfig)
  });
}

export async function getSelectedProvider() {
  const providerConfig = await getProviderConfig();
  return providerConfig.selectedProvider;
}

export async function setSelectedProvider(providerId) {
  const providerConfig = await getProviderConfig();
  providerConfig.selectedProvider = normalizeProviderId(providerId);
  await setProviderConfig(providerConfig);
}
