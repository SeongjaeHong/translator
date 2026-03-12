import { BaseTranslationProvider } from "./base-provider.js";
import { createChunks } from "./batching.js";

const DETECTION_CHUNK_SIZE = 20;
const TRANSLATION_CHUNK_SIZE = 10;
const DEFAULT_SOURCE_LANGUAGE = "und";
const MIN_TRANSLATABLE_LENGTH = 2;
const MIN_DETECTION_CONFIDENCE = 0.5;
const INVALID_TRANSLATOR_SOURCE_TAGS = new Set(["auto", "unknown", "und"]);
const BCP47_STYLE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function getLanguageDetectorApi() {
  return globalThis.LanguageDetector;
}

function getTranslatorApi() {
  return globalThis.Translator;
}

function canonicalizeLanguageTag(languageTag) {
  if (!languageTag || typeof languageTag !== "string") {
    return null;
  }

  const normalized = languageTag.trim().replace(/_/g, "-");

  if (!normalized) {
    return null;
  }

  if (!BCP47_STYLE_PATTERN.test(normalized)) {
    return null;
  }

  if (INVALID_TRANSLATOR_SOURCE_TAGS.has(normalized.toLowerCase())) {
    return null;
  }

  try {
    return Intl.getCanonicalLocales(normalized)[0] ?? null;
  } catch (_error) {
    return null;
  }
}

function normalizeDetectedLanguageTag(languageTag) {
  return canonicalizeLanguageTag(languageTag) ?? DEFAULT_SOURCE_LANGUAGE;
}

function normalizeTranslatorLanguageTag(languageTag) {
  return canonicalizeLanguageTag(languageTag);
}

function createTranslatorCacheKey(sourceLanguage, targetLanguage) {
  return `${sourceLanguage}::${targetLanguage}`;
}

function getPrimaryDetectionResult(detectionResult) {
  if (!Array.isArray(detectionResult) || detectionResult.length === 0) {
    return null;
  }

  return detectionResult[0] ?? null;
}

function isTrivialSegment(text) {
  if (!text || typeof text !== "string") {
    return true;
  }

  const normalized = text.trim();
  if (!normalized) {
    return true;
  }

  if (normalized.length < MIN_TRANSLATABLE_LENGTH) {
    return true;
  }

  return !/[\p{L}\p{N}]/u.test(normalized);
}

async function ensureDetectorReady(detectorApi) {
  if (typeof detectorApi?.availability !== "function") {
    return;
  }

  const availability = await detectorApi.availability();
  if (availability === "available") {
    return;
  }

  if (availability === "downloadable" && typeof detectorApi.create === "function") {
    const detector = await detectorApi.create();
    await detector.destroy?.();
    return;
  }

  throw new Error(`Language Detector API availability is ${availability}.`);
}

async function ensureTranslatorReady(translatorApi, sourceLanguage, targetLanguage) {
  if (typeof translatorApi?.availability !== "function") {
    return;
  }

  const availability = await translatorApi.availability({
    sourceLanguage,
    targetLanguage
  });

  if (availability === "available") {
    return;
  }

  if (availability === "downloadable" && typeof translatorApi.create === "function") {
    const translator = await translatorApi.create({ sourceLanguage, targetLanguage });
    await translator.destroy?.();
    return;
  }

  throw new Error(
    `Translator API availability for ${sourceLanguage}->${targetLanguage} is ${availability}.`
  );
}

export class ChromeBuiltInTranslationProvider extends BaseTranslationProvider {
  async checkAvailability(targetLanguage = "ko") {
    const languageDetectorApi = getLanguageDetectorApi();
    const translatorApi = getTranslatorApi();

    if (!languageDetectorApi || !translatorApi) {
      return {
        isAvailable: false,
        reason:
          "Built-in Language Detector / Translator APIs are unavailable. Use Chrome with built-in AI translation support."
      };
    }

    try {
      await ensureDetectorReady(languageDetectorApi);
      const normalizedTargetLanguage = normalizeTranslatorLanguageTag(targetLanguage);
      if (!normalizedTargetLanguage) {
        throw new Error(`Invalid target language: ${String(targetLanguage)}`);
      }

      return { isAvailable: true, reason: null };
    } catch (error) {
      return {
        isAvailable: false,
        reason: error instanceof Error ? error.message : "Built-in translation APIs are unavailable."
      };
    }
  }

  async detectLanguages(segments) {
    const detectorApi = getLanguageDetectorApi();

    if (!detectorApi?.create) {
      return segments.map((segment) => ({
        segmentId: segment.segmentId,
        language: DEFAULT_SOURCE_LANGUAGE,
        confidence: 0,
        skipped: true
      }));
    }

    const detector = await detectorApi.create();
    const results = [];

    try {
      for (const chunk of createChunks(segments, DETECTION_CHUNK_SIZE)) {
        const detectedChunk = await Promise.all(
          chunk.map(async (segment) => {
            if (isTrivialSegment(segment.sourceText)) {
              return {
                segmentId: segment.segmentId,
                language: DEFAULT_SOURCE_LANGUAGE,
                confidence: 0,
                skipped: true
              };
            }

            const detection = await detector.detect(segment.sourceText);
            const primary = getPrimaryDetectionResult(detection);
            const detectedLanguage = normalizeDetectedLanguageTag(primary?.detectedLanguage);
            const confidence = primary?.confidence ?? 0;

            if (
              detectedLanguage === DEFAULT_SOURCE_LANGUAGE ||
              confidence < MIN_DETECTION_CONFIDENCE
            ) {
              return {
                segmentId: segment.segmentId,
                language: DEFAULT_SOURCE_LANGUAGE,
                confidence,
                skipped: true
              };
            }

            return {
              segmentId: segment.segmentId,
              language: detectedLanguage,
              confidence,
              skipped: false
            };
          })
        );

        results.push(...detectedChunk);
      }
    } finally {
      await detector.destroy?.();
    }

    return results;
  }

  async translateSegments(segments, targetLanguage, detectedLanguagesBySegmentId) {
    const translatorApi = getTranslatorApi();
    const normalizedTargetLanguage = normalizeTranslatorLanguageTag(targetLanguage);

    if (!normalizedTargetLanguage) {
      throw new Error(`Invalid target language: ${String(targetLanguage)}`);
    }

    const translated = [];
    const segmentsByLanguage = new Map();
    const translatorByLanguagePair = new Map();
    const unavailableLanguagePairs = new Set();

    segments.forEach((segment) => {
      const sourceLanguage = normalizeDetectedLanguageTag(
        detectedLanguagesBySegmentId.get(segment.segmentId)
      );

      if (!segmentsByLanguage.has(sourceLanguage)) {
        segmentsByLanguage.set(sourceLanguage, []);
      }

      segmentsByLanguage.get(sourceLanguage).push(segment);
    });

    const getTranslatorForPair = async (sourceLanguage) => {
      if (!translatorApi?.create) {
        return null;
      }

      const cacheKey = createTranslatorCacheKey(sourceLanguage, normalizedTargetLanguage);
      if (translatorByLanguagePair.has(cacheKey)) {
        return translatorByLanguagePair.get(cacheKey);
      }

      if (unavailableLanguagePairs.has(cacheKey)) {
        return null;
      }

      try {
        await ensureTranslatorReady(translatorApi, sourceLanguage, normalizedTargetLanguage);
        const translator = await translatorApi.create({
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage
        });

        translatorByLanguagePair.set(cacheKey, translator);
        return translator;
      } catch (_error) {
        unavailableLanguagePairs.add(cacheKey);
        return null;
      }
    };

    try {
      for (const [sourceLanguage, segmentsForLanguage] of segmentsByLanguage.entries()) {
        const normalizedSourceLanguage = normalizeTranslatorLanguageTag(sourceLanguage);

        if (!normalizedSourceLanguage || normalizedSourceLanguage === normalizedTargetLanguage) {
          translated.push(
            ...segmentsForLanguage.map((segment) => ({
              segmentId: segment.segmentId,
              translatedText: segment.sourceText,
              skipped: true,
              reason:
                normalizedSourceLanguage === normalizedTargetLanguage
                  ? "source-is-target"
                  : "source-language-unavailable"
            }))
          );
          continue;
        }

        const translator = await getTranslatorForPair(normalizedSourceLanguage);

        if (!translator) {
          translated.push(
            ...segmentsForLanguage.map((segment) => ({
              segmentId: segment.segmentId,
              translatedText: segment.sourceText,
              skipped: true,
              reason: "source-language-unavailable"
            }))
          );

          continue;
        }

        for (const chunk of createChunks(segmentsForLanguage, TRANSLATION_CHUNK_SIZE)) {
          const translatedChunk = await Promise.all(
            chunk.map(async (segment) => {
              if (isTrivialSegment(segment.sourceText)) {
                return {
                  segmentId: segment.segmentId,
                  translatedText: segment.sourceText,
                  skipped: true,
                  reason: "trivial"
                };
              }

              try {
                const translatedText = await translator.translate(segment.sourceText);
                return {
                  segmentId: segment.segmentId,
                  translatedText,
                  skipped: false,
                  reason: null
                };
              } catch (_error) {
                return {
                  segmentId: segment.segmentId,
                  translatedText: segment.sourceText,
                  skipped: true,
                  reason: "translation-failed"
                };
              }
            })
          );

          translated.push(...translatedChunk);
        }
      }
    } finally {
      await Promise.all(
        Array.from(translatorByLanguagePair.values()).map((translator) => translator.destroy?.())
      );
    }

    return translated;
  }
}
