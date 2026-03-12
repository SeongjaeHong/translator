import { BaseTranslationProvider } from "./base-provider.js";
import { createChunks } from "./batching.js";

const DETECTION_CHUNK_SIZE = 20;
const TRANSLATION_CHUNK_SIZE = 10;
const DEFAULT_SOURCE_LANGUAGE = "und";
const MIN_TRANSLATABLE_LENGTH = 2;

function getLanguageDetectorApi() {
  return globalThis.LanguageDetector;
}

function getTranslatorApi() {
  return globalThis.Translator;
}

function normalizeLanguageTag(languageTag) {
  if (!languageTag || typeof languageTag !== "string") {
    return DEFAULT_SOURCE_LANGUAGE;
  }

  const normalized = languageTag.trim().toLowerCase();
  return normalized || DEFAULT_SOURCE_LANGUAGE;
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
      await ensureTranslatorReady(translatorApi, "en", normalizeLanguageTag(targetLanguage));
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
            return {
              segmentId: segment.segmentId,
              language: normalizeLanguageTag(primary?.detectedLanguage),
              confidence: primary?.confidence ?? 0,
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
    const normalizedTargetLanguage = normalizeLanguageTag(targetLanguage);
    const translated = [];
    const segmentsByLanguage = new Map();

    segments.forEach((segment) => {
      const sourceLanguage =
        normalizeLanguageTag(detectedLanguagesBySegmentId.get(segment.segmentId)) ??
        DEFAULT_SOURCE_LANGUAGE;

      if (!segmentsByLanguage.has(sourceLanguage)) {
        segmentsByLanguage.set(sourceLanguage, []);
      }

      segmentsByLanguage.get(sourceLanguage).push(segment);
    });

    for (const [sourceLanguage, segmentsForLanguage] of segmentsByLanguage.entries()) {
      if (
        !translatorApi?.create ||
        sourceLanguage === DEFAULT_SOURCE_LANGUAGE ||
        sourceLanguage === normalizedTargetLanguage
      ) {
        translated.push(
          ...segmentsForLanguage.map((segment) => ({
            segmentId: segment.segmentId,
            translatedText: segment.sourceText,
            skipped: true,
            reason:
              sourceLanguage === normalizedTargetLanguage
                ? "source-is-target"
                : "source-language-unavailable"
          }))
        );
        continue;
      }

      await ensureTranslatorReady(translatorApi, sourceLanguage, normalizedTargetLanguage);
      const translator = await translatorApi.create({
        sourceLanguage,
        targetLanguage: normalizedTargetLanguage
      });

      try {
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

              return {
                segmentId: segment.segmentId,
                translatedText: await translator.translate(segment.sourceText),
                skipped: false,
                reason: null
              };
            })
          );

          translated.push(...translatedChunk);
        }
      } finally {
        await translator.destroy?.();
      }
    }

    return translated;
  }
}
