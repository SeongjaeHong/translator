const sharedRuntime = globalThis.__PAGE_TRANSLATOR_SHARED__;
const DEFAULT_TARGET_LANGUAGE = sharedRuntime?.DEFAULT_TARGET_LANGUAGE ?? "ko";
const MESSAGE_TYPES = sharedRuntime?.MESSAGE_TYPES ?? {
  GET_PAGE_TRANSLATION_STATE_REQUESTED: "GET_PAGE_TRANSLATION_STATE_REQUESTED",
  PAGE_TRANSLATION_ACTION_REQUESTED: "PAGE_TRANSLATION_ACTION_REQUESTED"
};

function createChunks(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

const DETECTION_CHUNK_SIZE = 20;
const TRANSLATION_CHUNK_SIZE = 10;
const DEFAULT_SOURCE_LANGUAGE = "und";
const MIN_TRANSLATABLE_LENGTH = 2;
const MIN_DETECTION_CONFIDENCE = 0.5;
const MIN_DETECTION_TEXT_LENGTH = 4;
const DOMINANT_SAMPLE_LIMIT = 24;
const DOMINANT_MIN_SAMPLE_COUNT = 3;
const DOMINANT_MIN_SHARE = 0.6;
const DOMINANT_MIN_CONFIDENCE = 0.55;
const EXCEPTION_DETECTION_MIN_LENGTH = 24;
const INVALID_TRANSLATOR_SOURCE_TAGS = new Set(["auto", "unknown", "und"]);
const BCP47_STYLE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const MAX_TRIVIAL_SEGMENT_LENGTH = 3;
const SHORT_DATE_LIKE_SEGMENT_PATTERN = /^\d{1,4}(?:\s*[./:-]\s*\d{1,4}){1,2}$/u;

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

function createTranslationResultCacheKey(sourceLanguage, sourceText) {
  return `${sourceLanguage}::${sourceText}`;
}

function getPrimaryDetectionResult(detectionResult) {
  if (!Array.isArray(detectionResult) || detectionResult.length === 0) {
    return null;
  }

  return detectionResult[0] ?? null;
}

function isDateLikeSegment(text) {
  if (!text || typeof text !== "string") {
    return false;
  }

  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return SHORT_DATE_LIKE_SEGMENT_PATTERN.test(normalized);
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

  if (
    normalized.length <= MAX_TRIVIAL_SEGMENT_LENGTH &&
    !/\s/u.test(normalized) &&
    !isDateLikeSegment(normalized)
  ) {
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

function shouldSkipLanguageDetection(text) {
  if (isTrivialSegment(text)) {
    return true;
  }

  const normalized = text.trim();
  if (isDateLikeSegment(normalized)) {
    return false;
  }

  return normalized.length < MIN_DETECTION_TEXT_LENGTH;
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

class ChromeBuiltInTranslationProvider {
  constructor(sessionCache) {
    this.sessionCache = sessionCache;
  }

  async checkAvailability(targetLanguage = DEFAULT_TARGET_LANGUAGE) {
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
      const normalizedTargetLanguage = normalizeTranslatorLanguageTag(targetLanguage);
      if (!normalizedTargetLanguage) {
        throw new Error(`Invalid target language: ${String(targetLanguage)}`);
      }

      if (!this.sessionCache.isDetectorReady) {
        await ensureDetectorReady(languageDetectorApi);
        this.sessionCache.isDetectorReady = true;
      }

      return { isAvailable: true, reason: null };
    } catch (error) {
      return {
        isAvailable: false,
        reason: error instanceof Error ? error.message : "Built-in translation APIs are unavailable."
      };
    }
  }

  async getOrCreateDetector() {
    const detectorApi = getLanguageDetectorApi();

    if (!detectorApi?.create) {
      return null;
    }

    const detector = this.sessionCache.detector ?? (await detectorApi.create());
    this.sessionCache.detector = detector;
    return detector;
  }

  async detectLanguagesForSegments(segments) {
    const detector = await this.getOrCreateDetector();

    if (!detector) {
      return segments.map((segment) => ({
        segmentId: segment.segmentId,
        language: DEFAULT_SOURCE_LANGUAGE,
        confidence: 0,
        skipped: true
      }));
    }

    const uncachedSegments = [];
    const results = [];

    segments.forEach((segment) => {
      const cachedDetection = this.sessionCache.detectedLanguageByText.get(segment.sourceText);

      if (cachedDetection) {
        results.push({
          segmentId: segment.segmentId,
          language: cachedDetection.language,
          confidence: cachedDetection.confidence,
          skipped: cachedDetection.skipped
        });
      } else {
        uncachedSegments.push(segment);
      }
    });

    this.sessionCache.metrics.detectionCacheHitCount += results.length;
    this.sessionCache.metrics.detectionCacheMissCount += uncachedSegments.length;

    if (!uncachedSegments.length) {
      return results;
    }

    const detectionStart = performance.now();

    for (const chunk of createChunks(uncachedSegments, DETECTION_CHUNK_SIZE)) {
      const detectedChunk = await Promise.all(
        chunk.map(async (segment) => {
          if (shouldSkipLanguageDetection(segment.sourceText)) {
            const skippedDetection = {
              language: DEFAULT_SOURCE_LANGUAGE,
              confidence: 0,
              skipped: true
            };
            this.sessionCache.detectedLanguageByText.set(segment.sourceText, skippedDetection);
            return {
              segmentId: segment.segmentId,
              ...skippedDetection
            };
          }

          const detection = await detector.detect(segment.sourceText);
          const primary = getPrimaryDetectionResult(detection);
          const detectedLanguage = normalizeDetectedLanguageTag(primary?.detectedLanguage);
          const confidence = primary?.confidence ?? 0;
          const shouldSkip =
            detectedLanguage === DEFAULT_SOURCE_LANGUAGE || confidence < MIN_DETECTION_CONFIDENCE;
          const detectionResult = {
            language: shouldSkip ? DEFAULT_SOURCE_LANGUAGE : detectedLanguage,
            confidence,
            skipped: shouldSkip
          };

          this.sessionCache.detectedLanguageByText.set(segment.sourceText, detectionResult);

          return {
            segmentId: segment.segmentId,
            ...detectionResult
          };
        })
      );

      results.push(...detectedChunk);
    }

    this.sessionCache.metrics.detectionExecutionMs += performance.now() - detectionStart;

    return results;
  }

  selectRepresentativeSegments(segments) {
    return [...segments]
      .filter((segment) => !shouldSkipLanguageDetection(segment.sourceText))
      .sort((a, b) => b.sourceText.length - a.sourceText.length)
      .slice(0, DOMINANT_SAMPLE_LIMIT);
  }

  decideDominantLanguage(sampleDetections, representativeSegments) {
    if (sampleDetections.length < DOMINANT_MIN_SAMPLE_COUNT) {
      return null;
    }

    const aggregate = new Map();

    sampleDetections.forEach((detection) => {
      if (detection.skipped || detection.language === DEFAULT_SOURCE_LANGUAGE) {
        return;
      }

      const segment = representativeSegments.find((item) => item.segmentId === detection.segmentId);
      const weight = Math.max(1, segment?.sourceText.length ?? 1);
      const score = weight * Math.max(0.1, detection.confidence || 0);
      const current = aggregate.get(detection.language) ?? { score: 0, weightedConfidence: 0, count: 0 };
      current.score += score;
      current.weightedConfidence += score * (detection.confidence || 0);
      current.count += 1;
      aggregate.set(detection.language, current);
    });

    if (!aggregate.size) {
      return null;
    }

    const sorted = [...aggregate.entries()].sort((a, b) => b[1].score - a[1].score);
    const [dominantLanguage, dominantData] = sorted[0];
    const totalScore = sorted.reduce((sum, [, data]) => sum + data.score, 0);
    const dominantShare = totalScore ? dominantData.score / totalScore : 0;
    const dominantConfidence = dominantData.score
      ? dominantData.weightedConfidence / dominantData.score
      : 0;

    if (dominantShare < DOMINANT_MIN_SHARE || dominantConfidence < DOMINANT_MIN_CONFIDENCE) {
      return {
        language: dominantLanguage,
        confidence: dominantConfidence,
        share: dominantShare,
        strong: false
      };
    }

    return {
      language: dominantLanguage,
      confidence: dominantConfidence,
      share: dominantShare,
      strong: true
    };
  }

  async detectLanguagesOptimized(segments) {
    const representativeSegments = this.selectRepresentativeSegments(segments);
    const sampleDetections = await this.detectLanguagesForSegments(representativeSegments);
    const dominantDecision = this.decideDominantLanguage(sampleDetections, representativeSegments);

    this.sessionCache.metrics.sampledSegmentCount = representativeSegments.length;
    this.sessionCache.metrics.dominantLanguage = dominantDecision?.language ?? null;
    this.sessionCache.metrics.dominantLanguageConfidence = dominantDecision?.confidence ?? 0;

    if (!dominantDecision?.strong) {
      this.sessionCache.metrics.fallbackPathCount += 1;
      const detectedLanguages = await this.detectLanguagesForSegments(segments);
      return {
        detectedLanguages,
        dominantDecision: {
          ...dominantDecision,
          usedFastPath: false
        }
      };
    }

    this.sessionCache.metrics.fastPathCount += 1;

    const detectedById = new Map();
    const exceptionCandidates = [];
    const dominantScriptGroup = getScriptGroupForText(
      representativeSegments.find((segment) => segment.sourceText)?.sourceText ?? ""
    );

    segments.forEach((segment) => {
      if (shouldSkipLanguageDetection(segment.sourceText)) {
        detectedById.set(segment.segmentId, {
          segmentId: segment.segmentId,
          language: DEFAULT_SOURCE_LANGUAGE,
          confidence: 0,
          skipped: true
        });
        return;
      }

      const scriptGroup = getScriptGroupForText(segment.sourceText);
      const shouldDetectAsException =
        segment.sourceText.length >= EXCEPTION_DETECTION_MIN_LENGTH &&
        scriptGroup !== "unknown" &&
        dominantScriptGroup !== "unknown" &&
        scriptGroup !== dominantScriptGroup;

      if (shouldDetectAsException) {
        exceptionCandidates.push(segment);
      } else {
        detectedById.set(segment.segmentId, {
          segmentId: segment.segmentId,
          language: dominantDecision.language,
          confidence: dominantDecision.confidence,
          skipped: false
        });
      }
    });

    this.sessionCache.metrics.exceptionDetectionCount += exceptionCandidates.length;

    if (exceptionCandidates.length) {
      const exceptionDetections = await this.detectLanguagesForSegments(exceptionCandidates);
      exceptionDetections.forEach((result) => {
        if (!result.skipped && result.language !== DEFAULT_SOURCE_LANGUAGE) {
          detectedById.set(result.segmentId, result);
          return;
        }

        detectedById.set(result.segmentId, {
          segmentId: result.segmentId,
          language: dominantDecision.language,
          confidence: dominantDecision.confidence,
          skipped: false
        });
      });
    }

    const detectedLanguages = segments.map((segment) =>
      detectedById.get(segment.segmentId) ?? {
        segmentId: segment.segmentId,
        language: dominantDecision.language,
        confidence: dominantDecision.confidence,
        skipped: false
      }
    );

    return {
      detectedLanguages,
      dominantDecision: {
        ...dominantDecision,
        usedFastPath: true,
        exceptionCandidateCount: exceptionCandidates.length
      }
    };
  }

  async translateSegments(segments, targetLanguage, detectedLanguagesBySegmentId) {
    const translatorApi = getTranslatorApi();
    const normalizedTargetLanguage = normalizeTranslatorLanguageTag(targetLanguage);

    if (!normalizedTargetLanguage) {
      throw new Error(`Invalid target language: ${String(targetLanguage)}`);
    }

    const translated = [];
    const segmentsByLanguage = new Map();
    const translationCache = this.sessionCache.getTranslationCache(normalizedTargetLanguage);

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
      if (this.sessionCache.translatorByLanguagePair.has(cacheKey)) {
        this.sessionCache.metrics.translatorCacheHitCount += 1;
        return this.sessionCache.translatorByLanguagePair.get(cacheKey);
      }

      if (this.sessionCache.unavailableLanguagePairs.has(cacheKey)) {
        this.sessionCache.metrics.translatorCacheHitCount += 1;
        return null;
      }

      this.sessionCache.metrics.translatorCacheMissCount += 1;

      try {
        const availabilityStart = performance.now();
        await ensureTranslatorReady(translatorApi, sourceLanguage, normalizedTargetLanguage);
        this.sessionCache.metrics.translatorAvailabilityMs += performance.now() - availabilityStart;

        const createStart = performance.now();
        const translator = await translatorApi.create({
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage
        });
        this.sessionCache.metrics.translatorCreateMs += performance.now() - createStart;

        this.sessionCache.translatorByLanguagePair.set(cacheKey, translator);
        return translator;
      } catch (_error) {
        this.sessionCache.unavailableLanguagePairs.add(cacheKey);
        return null;
      }
    };

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

            const translationCacheKey = createTranslationResultCacheKey(
              normalizedSourceLanguage,
              segment.sourceText
            );
            const hasCachedTranslation = translationCache.has(translationCacheKey);
            const cachedTranslation = hasCachedTranslation
              ? translationCache.get(translationCacheKey)
              : null;

            if (hasCachedTranslation) {
              this.sessionCache.metrics.translationCacheHitCount += 1;
              return {
                segmentId: segment.segmentId,
                translatedText: cachedTranslation,
                skipped: false,
                reason: "cache-hit"
              };
            }

            this.sessionCache.metrics.translationCacheMissCount += 1;

            try {
              const executionStart = performance.now();
              const translatedText = await translator.translate(segment.sourceText);
              this.sessionCache.metrics.translationExecutionMs += performance.now() - executionStart;
              translationCache.set(translationCacheKey, translatedText);
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

    return translated;
  }
}



function createTranslationProvider() {
  return new ChromeBuiltInTranslationProvider(translationSessionCache);
}

const EXCLUDED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "CODE",
  "PRE",
  "SVG"
]);

let lastExtraction = null;

const translationSessionCache = {
  detector: null,
  isDetectorReady: false,
  detectedLanguageByText: new Map(),
  translatedByTargetLanguage: new Map(),
  translatorByLanguagePair: new Map(),
  unavailableLanguagePairs: new Set(),
  metrics: {
    detectionCacheHitCount: 0,
    detectionCacheMissCount: 0,
    translatorCacheHitCount: 0,
    translatorCacheMissCount: 0,
    translationCacheHitCount: 0,
    translationCacheMissCount: 0,
    sampledSegmentCount: 0,
    dominantLanguage: null,
    dominantLanguageConfidence: 0,
    fastPathCount: 0,
    fallbackPathCount: 0,
    exceptionDetectionCount: 0,
    detectionExecutionMs: 0,
    translatorAvailabilityMs: 0,
    translatorCreateMs: 0,
    translationExecutionMs: 0
  },
  getTranslationCache(targetLanguage) {
    if (!this.translatedByTargetLanguage.has(targetLanguage)) {
      this.translatedByTargetLanguage.set(targetLanguage, new Map());
    }

    return this.translatedByTargetLanguage.get(targetLanguage);
  },
  invalidateTargetTranslationCache(targetLanguage) {
    if (!targetLanguage) {
      return;
    }

    this.translatedByTargetLanguage.delete(targetLanguage);

    for (const cacheKey of this.translatorByLanguagePair.keys()) {
      if (cacheKey.endsWith(`::${targetLanguage}`)) {
        const translator = this.translatorByLanguagePair.get(cacheKey);
        translator?.destroy?.();
        this.translatorByLanguagePair.delete(cacheKey);
      }
    }

    for (const cacheKey of [...this.unavailableLanguagePairs]) {
      if (cacheKey.endsWith(`::${targetLanguage}`)) {
        this.unavailableLanguagePairs.delete(cacheKey);
      }
    }
  }
};

const translationState = {
  isTranslated: false,
  targetLanguage: null,
  translatedNodes: [],
  lastError: null,
  lastStats: null,
  inFlightAction: null,
  lastAppliedTargetLanguage: null
};

function isHiddenElement(element) {
  if (!element) {
    return false;
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return true;
  }

  const style = window.getComputedStyle(element);

  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  );
}

function isInsideExcludedContainer(element) {
  if (!element) {
    return true;
  }

  let current = element;

  while (current) {
    if (EXCLUDED_TAGS.has(current.tagName) || isHiddenElement(current)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function isUserFacingSegment(text) {
  return /[\p{L}\p{N}]/u.test(text);
}

function getScriptGroupForText(text) {
  if (!text || typeof text !== "string") {
    return "unknown";
  }

  const sample = text.slice(0, 200);
  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(sample);
  if (hasCjk) {
    return "cjk";
  }

  if (/\p{Script=Cyrillic}/u.test(sample)) {
    return "cyrillic";
  }

  if (/\p{Script=Arabic}/u.test(sample)) {
    return "arabic";
  }

  if (/\p{Script=Devanagari}/u.test(sample)) {
    return "devanagari";
  }

  if (/\p{Script=Hebrew}/u.test(sample)) {
    return "hebrew";
  }

  if (/\p{Script=Greek}/u.test(sample)) {
    return "greek";
  }

  if (/\p{Script=Latin}/u.test(sample)) {
    return "latin";
  }

  return "unknown";
}

function collectTranslatableTextSegments(root = document.body) {
  if (!root) {
    return {
      totalTextNodesFound: 0,
      totalSkippedNodes: 0,
      segments: [],
      nodeMappings: []
    };
  }

  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const dedupedSegmentsByText = new Map();
  const nodeMappings = [];

  let totalTextNodesFound = 0;
  let totalSkippedNodes = 0;
  let textNode = treeWalker.nextNode();

  while (textNode) {
    totalTextNodesFound += 1;

    const parentElement = textNode.parentElement;

    if (isInsideExcludedContainer(parentElement)) {
      totalSkippedNodes += 1;
      textNode = treeWalker.nextNode();
      continue;
    }

    const originalText = textNode.nodeValue ?? "";
    const normalizedText = normalizeText(originalText);

    if (!normalizedText || !isUserFacingSegment(normalizedText)) {
      totalSkippedNodes += 1;
      textNode = treeWalker.nextNode();
      continue;
    }

    const nodeMapping = {
      textNode,
      parentElement,
      originalText,
      normalizedText
    };

    const mappingIndex = nodeMappings.push(nodeMapping) - 1;
    const existingSegment = dedupedSegmentsByText.get(normalizedText);

    if (existingSegment) {
      existingSegment.nodeMappingIndexes.push(mappingIndex);
    } else {
      dedupedSegmentsByText.set(normalizedText, {
        segmentId: dedupedSegmentsByText.size,
        sourceText: normalizedText,
        nodeMappingIndexes: [mappingIndex]
      });
    }

    textNode = treeWalker.nextNode();
  }

  return {
    totalTextNodesFound,
    totalSkippedNodes,
    segments: [...dedupedSegmentsByText.values()],
    nodeMappings
  };
}

function createStatsFromResults(
  extraction,
  detectedLanguages,
  translatedSegments,
  pipelineMetrics,
  domWriteMetrics
) {
  const detectedCount = detectedLanguages.filter((item) => !item.skipped).length;
  const translatedCount = translatedSegments.filter((item) => !item.skipped).length;
  const skippedCount = extraction.segments.length - translatedCount;

  const detectedLanguageGroups = detectedLanguages.reduce((groups, item) => {
    const currentCount = groups[item.language] ?? 0;
    groups[item.language] = currentCount + 1;
    return groups;
  }, {});

  return {
    extractionCount: extraction.segments.length,
    detectedLanguageCount: detectedCount,
    detectedLanguageGroups,
    translatedCount,
    skippedCount,
    restoredCount: 0,
    sampledSegmentCount: pipelineMetrics.sampledSegmentCount ?? 0,
    dominantLanguageDecision: {
      language: pipelineMetrics.dominantLanguage ?? null,
      confidence: pipelineMetrics.dominantLanguageConfidence ?? 0,
      usedFastPath: pipelineMetrics.usedFastPath ?? false,
      fallbackUsed: pipelineMetrics.fallbackUsed ?? true,
      exceptionCandidateCount: pipelineMetrics.exceptionCandidateCount ?? 0
    },
    stageDurationsMs: {
      extraction: pipelineMetrics.extractionMs ?? 0,
      availability: pipelineMetrics.availabilityMs ?? 0,
      detection: pipelineMetrics.detectionMs ?? 0,
      translation: pipelineMetrics.translationMs ?? 0,
      domWrite: pipelineMetrics.domWriteMs ?? 0
    },
    domWriteMetrics,
    cacheMetrics: { ...translationSessionCache.metrics }
  };
}

function rehydrateWhitespace(originalText, normalizedText, translatedText) {
  if (typeof translatedText !== "string") {
    return translatedText;
  }

  if (originalText === normalizedText) {
    return translatedText;
  }

  const leadingWhitespace = originalText.match(/^\s*/u)?.[0] ?? "";
  const trailingWhitespace = originalText.match(/\s*$/u)?.[0] ?? "";
  return `${leadingWhitespace}${translatedText}${trailingWhitespace}`;
}

function writeTranslatedTextToNodes(extraction, translatedSegments) {
  const translatedSegmentsById = new Map(
    translatedSegments.map((segment) => [segment.segmentId, segment.translatedText])
  );

  const translatedNodes = [];
  let updatedNodeCount = 0;
  let unchangedNodeCount = 0;

  extraction.segments.forEach((segment) => {
    const translatedText = translatedSegmentsById.get(segment.segmentId);

    segment.nodeMappingIndexes.forEach((mappingIndex) => {
      const nodeMapping = extraction.nodeMappings[mappingIndex];
      if (!nodeMapping?.textNode || typeof translatedText !== "string") {
        return;
      }

      const translatedNodeText = rehydrateWhitespace(
        nodeMapping.originalText,
        nodeMapping.normalizedText,
        translatedText
      );

      if (nodeMapping.textNode.nodeValue !== translatedNodeText) {
        nodeMapping.textNode.nodeValue = translatedNodeText;
        updatedNodeCount += 1;
      } else {
        unchangedNodeCount += 1;
      }

      translatedNodes.push({
        textNode: nodeMapping.textNode,
        originalText: nodeMapping.originalText,
        translatedText: translatedNodeText
      });
    });
  });

  return { translatedNodes, updatedNodeCount, unchangedNodeCount };
}

function resetStateAfterRestore(restoredCount = 0) {
  translationState.isTranslated = false;
  translationState.targetLanguage = null;
  translationState.translatedNodes = [];
  translationState.lastError = null;
  translationState.lastStats = {
    extractionCount: lastExtraction?.segments.length ?? 0,
    detectedLanguageCount: translationState.lastStats?.detectedLanguageCount ?? 0,
    translatedCount: 0,
    skippedCount: 0,
    restoredCount,
    cacheMetrics: { ...translationSessionCache.metrics }
  };
}

function restoreOriginalText() {
  let restoredCount = 0;

  translationState.translatedNodes.forEach((nodeState) => {
    if (!nodeState.textNode || !nodeState.textNode.isConnected) {
      return;
    }

    nodeState.textNode.nodeValue = nodeState.originalText;
    restoredCount += 1;
  });

  resetStateAfterRestore(restoredCount);
}

function invalidateTranslationStateForTargetChange(nextTargetLanguage) {
  const normalizedNextTargetLanguage = normalizeTranslatorLanguageTag(nextTargetLanguage);
  const previousTargetLanguage = translationState.lastAppliedTargetLanguage;

  if (!previousTargetLanguage || !normalizedNextTargetLanguage) {
    return;
  }

  if (previousTargetLanguage !== normalizedNextTargetLanguage) {
    translationSessionCache.invalidateTargetTranslationCache(previousTargetLanguage);
  }
}

function validateCapability(capability) {
  if (capability?.isAvailable) {
    return;
  }

  throw new Error(
    capability?.reason ??
      "Built-in translation is unavailable in this environment. Use a Chrome build with the Language Detector and Translator APIs enabled."
  );
}

async function applyTranslation(targetLanguage) {
  const extractionStart = performance.now();
  const extraction = collectTranslatableTextSegments(document.body);
  const extractionMs = performance.now() - extractionStart;
  lastExtraction = extraction;

  if (extraction.segments.length === 0) {
    translationState.isTranslated = false;
    translationState.targetLanguage = null;
    translationState.translatedNodes = [];
    translationState.lastError = null;
    translationState.lastStats = {
      extractionCount: 0,
      detectedLanguageCount: 0,
      translatedCount: 0,
      skippedCount: 0,
      restoredCount: 0,
      sampledSegmentCount: 0,
      dominantLanguageDecision: null,
      stageDurationsMs: {
        extraction: extractionMs,
        availability: 0,
        detection: 0,
        translation: 0,
        domWrite: 0
      },
      domWriteMetrics: { updatedNodeCount: 0, unchangedNodeCount: 0 },
      cacheMetrics: { ...translationSessionCache.metrics }
    };

    return;
  }

  const provider = createTranslationProvider();
  const normalizedTargetLanguage = targetLanguage || DEFAULT_TARGET_LANGUAGE;

  const availabilityStart = performance.now();
  const capability = await provider.checkAvailability(normalizedTargetLanguage);
  const availabilityMs = performance.now() - availabilityStart;
  validateCapability(capability);

  const detectionStart = performance.now();
  const { detectedLanguages, dominantDecision } = await provider.detectLanguagesOptimized(
    extraction.segments
  );
  const detectionMs = performance.now() - detectionStart;
  const detectedLanguagesBySegmentId = new Map(
    detectedLanguages.map((result) => [result.segmentId, result.language])
  );

  const translationStart = performance.now();
  const translatedSegments = await provider.translateSegments(
    extraction.segments,
    normalizedTargetLanguage,
    detectedLanguagesBySegmentId
  );
  const translationMs = performance.now() - translationStart;

  const domWriteStart = performance.now();
  const { translatedNodes, updatedNodeCount, unchangedNodeCount } = writeTranslatedTextToNodes(
    extraction,
    translatedSegments
  );
  const domWriteMs = performance.now() - domWriteStart;

  const stats = createStatsFromResults(
    extraction,
    detectedLanguages,
    translatedSegments,
    {
      extractionMs,
      availabilityMs,
      detectionMs,
      translationMs,
      domWriteMs,
      sampledSegmentCount: translationSessionCache.metrics.sampledSegmentCount,
      dominantLanguage: dominantDecision?.language ?? null,
      dominantLanguageConfidence: dominantDecision?.confidence ?? 0,
      usedFastPath: Boolean(dominantDecision?.usedFastPath),
      fallbackUsed: !dominantDecision?.usedFastPath,
      exceptionCandidateCount: dominantDecision?.exceptionCandidateCount ?? 0
    },
    { updatedNodeCount, unchangedNodeCount }
  );

  translationState.isTranslated = true;
  translationState.targetLanguage = normalizedTargetLanguage;
  translationState.translatedNodes = translatedNodes;
  translationState.lastError = null;
  translationState.lastAppliedTargetLanguage = normalizedTargetLanguage;
  translationState.lastStats = stats;

}

async function translateOrRetranslate(targetLanguage) {
  const normalizedTargetLanguage = targetLanguage || DEFAULT_TARGET_LANGUAGE;
  if (translationState.isTranslated) {
    restoreOriginalText();
  }

  await applyTranslation(normalizedTargetLanguage);
}

function getSerializableTranslationState() {
  return {
    isTranslated: translationState.isTranslated,
    targetLanguage: translationState.targetLanguage,
    totalTranslatedNodes: translationState.translatedNodes.length,
    lastError: translationState.lastError,
    lastStats: translationState.lastStats,
    inFlightAction: translationState.inFlightAction
  };
}

async function onPageTranslationActionRequested(action, targetLanguage) {
  if (translationState.inFlightAction) {
    throw new Error("Translation is already in progress. Please wait and try again.");
  }

  const normalizedAction = action ?? "toggle";

  translationState.inFlightAction = normalizedAction;

  try {
    if (normalizedAction === "restore") {
      if (translationState.isTranslated) {
        restoreOriginalText();
      }

      return getSerializableTranslationState();
    }

    if (normalizedAction === "translate") {
      invalidateTranslationStateForTargetChange(targetLanguage || DEFAULT_TARGET_LANGUAGE);
      await translateOrRetranslate(targetLanguage);
      return getSerializableTranslationState();
    }

    if (translationState.isTranslated) {
      restoreOriginalText();
      return getSerializableTranslationState();
    }

    await applyTranslation(targetLanguage);
    return getSerializableTranslationState();
  } finally {
    translationState.inFlightAction = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_PAGE_TRANSLATION_STATE_REQUESTED) {
    sendResponse(getSerializableTranslationState());
    return;
  }

  if (message?.type === MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED) {
    const action = message.payload?.action ?? "toggle";
    const language = message.payload?.targetLanguage ?? DEFAULT_TARGET_LANGUAGE;

    onPageTranslationActionRequested(action, language)
      .then((state) => sendResponse(state))
      .catch((error) => {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Built-in translation failed to initialize. Try reloading the page or enabling the required Chrome AI features.";

        translationState.lastError = errorMessage;
        translationState.inFlightAction = null;
        translationState.lastStats = {
          extractionCount: lastExtraction?.segments.length ?? 0,
          detectedLanguageCount: 0,
          translatedCount: 0,
          skippedCount: lastExtraction?.segments.length ?? 0,
          restoredCount: 0,
          cacheMetrics: { ...translationSessionCache.metrics }
        };

        sendResponse(getSerializableTranslationState());
      });

    return true;
  }
});

window.__pageTranslatorDebug = {
  collectTranslatableTextSegments,
  getLastExtraction: () => lastExtraction,
  getTranslationState: getSerializableTranslationState
};
