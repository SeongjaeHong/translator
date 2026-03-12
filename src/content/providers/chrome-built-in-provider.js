import { BaseTranslationProvider } from "./base-provider.js";
import { createChunks } from "./batching.js";

const DETECTION_CHUNK_SIZE = 20;
const TRANSLATION_CHUNK_SIZE = 10;
const DEFAULT_SOURCE_LANGUAGE = "und";

function getLanguageDetectorApi() {
  return globalThis.LanguageDetector;
}

function getTranslatorApi() {
  return globalThis.Translator;
}

function getPrimaryDetectionResult(detectionResult) {
  if (!Array.isArray(detectionResult) || detectionResult.length === 0) {
    return null;
  }

  return detectionResult[0] ?? null;
}

export class ChromeBuiltInTranslationProvider extends BaseTranslationProvider {
  async checkAvailability() {
    const languageDetectorApi = getLanguageDetectorApi();
    const translatorApi = getTranslatorApi();

    if (!languageDetectorApi || !translatorApi) {
      return {
        isAvailable: false,
        reason: "Chrome built-in AI translation APIs are not available in this environment."
      };
    }

    if (typeof languageDetectorApi.availability === "function") {
      const detectorAvailability = await languageDetectorApi.availability();
      if (detectorAvailability !== "available") {
        return {
          isAvailable: false,
          reason: `Language Detector API availability is ${detectorAvailability}.`
        };
      }
    }

    if (typeof translatorApi.availability === "function") {
      const translatorAvailability = await translatorApi.availability({
        sourceLanguage: "en",
        targetLanguage: "ko"
      });
      if (translatorAvailability !== "available") {
        return {
          isAvailable: false,
          reason: `Translator API availability is ${translatorAvailability}.`
        };
      }
    }

    return { isAvailable: true, reason: null };
  }

  async detectLanguages(segments) {
    const detectorApi = getLanguageDetectorApi();

    if (!detectorApi?.create) {
      return segments.map((segment) => ({
        segmentId: segment.segmentId,
        language: DEFAULT_SOURCE_LANGUAGE,
        confidence: 0
      }));
    }

    const detector = await detectorApi.create();
    const results = [];

    for (const chunk of createChunks(segments, DETECTION_CHUNK_SIZE)) {
      const detectedChunk = await Promise.all(
        chunk.map(async (segment) => {
          const detection = await detector.detect(segment.sourceText);
          const primary = getPrimaryDetectionResult(detection);
          return {
            segmentId: segment.segmentId,
            language: primary?.detectedLanguage ?? DEFAULT_SOURCE_LANGUAGE,
            confidence: primary?.confidence ?? 0
          };
        })
      );

      results.push(...detectedChunk);
    }

    await detector.destroy?.();
    return results;
  }

  async translateSegments(segments, targetLanguage, detectedLanguagesBySegmentId) {
    const translatorApi = getTranslatorApi();
    const translated = [];
    const segmentsByLanguage = new Map();

    segments.forEach((segment) => {
      const sourceLanguage =
        detectedLanguagesBySegmentId.get(segment.segmentId) ?? DEFAULT_SOURCE_LANGUAGE;

      if (!segmentsByLanguage.has(sourceLanguage)) {
        segmentsByLanguage.set(sourceLanguage, []);
      }

      segmentsByLanguage.get(sourceLanguage).push(segment);
    });

    for (const [sourceLanguage, segmentsForLanguage] of segmentsByLanguage.entries()) {
      if (!translatorApi?.create || sourceLanguage === DEFAULT_SOURCE_LANGUAGE) {
        translated.push(
          ...segmentsForLanguage.map((segment) => ({
            segmentId: segment.segmentId,
            translatedText: segment.sourceText
          }))
        );
        continue;
      }

      const translator = await translatorApi.create({
        sourceLanguage,
        targetLanguage
      });

      for (const chunk of createChunks(segmentsForLanguage, TRANSLATION_CHUNK_SIZE)) {
        const translatedChunk = await Promise.all(
          chunk.map(async (segment) => ({
            segmentId: segment.segmentId,
            translatedText: await translator.translate(segment.sourceText)
          }))
        );

        translated.push(...translatedChunk);
      }

      await translator.destroy?.();
    }

    return translated;
  }
}
