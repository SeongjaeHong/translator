/**
 * @typedef {Object} TranslationSegment
 * @property {number} segmentId
 * @property {string} sourceText
 */

/**
 * @typedef {Object} DetectedLanguageResult
 * @property {number} segmentId
 * @property {string} language
 * @property {number} confidence
 */

/**
 * @typedef {Object} TranslatedSegmentResult
 * @property {number} segmentId
 * @property {string} translatedText
 */

function detectLanguageHeuristic(text) {
  if (/\p{Script=Hangul}/u.test(text)) {
    return "ko";
  }

  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) {
    return "ja";
  }

  if (/\p{Script=Han}/u.test(text)) {
    return "zh";
  }

  if (/\p{Script=Cyrillic}/u.test(text)) {
    return "ru";
  }

  if (/\p{Script=Arabic}/u.test(text)) {
    return "ar";
  }

  if (/\p{Script=Latin}/u.test(text)) {
    return "en";
  }

  return "und";
}

export class BaseTranslationProvider {
  constructor({ providerId, config }) {
    this.providerId = providerId;
    this.config = config;
  }

  async detectLanguages(segments) {
    return segments.map((segment) => ({
      segmentId: segment.segmentId,
      language: detectLanguageHeuristic(segment.sourceText),
      confidence: 0.2
    }));
  }

  async translateSegments(segments, targetLanguage, detectedLanguagesBySegmentId) {
    return segments.map((segment) => {
      const detectedLanguage =
        detectedLanguagesBySegmentId.get(segment.segmentId) ?? "und";

      return {
        segmentId: segment.segmentId,
        translatedText: `[${this.providerId}:${detectedLanguage}->${targetLanguage}] ${segment.sourceText}`
      };
    });
  }
}
