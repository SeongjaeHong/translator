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

export class BaseTranslationProvider {
  async checkAvailability(_targetLanguage) {
    throw new Error("checkAvailability is not implemented");
  }

  async detectLanguages(_segments) {
    throw new Error("detectLanguages is not implemented");
  }

  async translateSegments(_segments, _targetLanguage, _detectedLanguagesBySegmentId) {
    throw new Error("translateSegments is not implemented");
  }
}
