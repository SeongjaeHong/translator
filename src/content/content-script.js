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

    const detector = this.sessionCache.detector ?? (await detectorApi.create());
    this.sessionCache.detector = detector;

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

          if (shouldSkip) {
            console.info("[Page Translator] Skipping segment due to weak/invalid language detection", {
              segmentId: segment.segmentId,
              detectedLanguage,
              confidence
            });
          }

          return {
            segmentId: segment.segmentId,
            ...detectionResult
          };
        })
      );

      results.push(...detectedChunk);
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

    console.info("[Page Translator] Grouped segments by detected language", {
      targetLanguage: normalizedTargetLanguage,
      groups: Array.from(segmentsByLanguage.entries()).map(([language, groupedSegments]) => ({
        sourceLanguage: language,
        segmentCount: groupedSegments.length
      }))
    });

    const getTranslatorForPair = async (sourceLanguage) => {
      if (!translatorApi?.create) {
        return null;
      }

      const cacheKey = createTranslatorCacheKey(sourceLanguage, normalizedTargetLanguage);
      if (this.sessionCache.translatorByLanguagePair.has(cacheKey)) {
        this.sessionCache.metrics.translatorCacheHitCount += 1;
        console.info("[Page Translator] Reusing cached translator", {
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage
        });

        return this.sessionCache.translatorByLanguagePair.get(cacheKey);
      }

      if (this.sessionCache.unavailableLanguagePairs.has(cacheKey)) {
        this.sessionCache.metrics.translatorCacheHitCount += 1;
        return null;
      }

      this.sessionCache.metrics.translatorCacheMissCount += 1;

      try {
        await ensureTranslatorReady(translatorApi, sourceLanguage, normalizedTargetLanguage);
        const translator = await translatorApi.create({
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage
        });

        this.sessionCache.translatorByLanguagePair.set(cacheKey, translator);
        console.info("[Page Translator] Created translator for language pair", {
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage
        });

        return translator;
      } catch (error) {
        this.sessionCache.unavailableLanguagePairs.add(cacheKey);
        console.warn("[Page Translator] Translator unavailable for language pair", {
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          error: error instanceof Error ? error.message : String(error)
        });

        return null;
      }
    };

    for (const [sourceLanguage, segmentsForLanguage] of segmentsByLanguage.entries()) {
      const normalizedSourceLanguage = normalizeTranslatorLanguageTag(sourceLanguage);

      if (
        !normalizedSourceLanguage ||
        normalizedSourceLanguage === normalizedTargetLanguage
      ) {
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

        console.info("[Page Translator] Skipping translation group", {
          sourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          segmentCount: segmentsForLanguage.length,
          reason:
            normalizedSourceLanguage === normalizedTargetLanguage
              ? "source-language-matches-target"
              : "source-language-unavailable"
        });
        continue;
      }

      console.info("[Page Translator] Translating segment group", {
        sourceLanguage: normalizedSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        segmentCount: segmentsForLanguage.length
      });

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
              const translatedText = await translator.translate(segment.sourceText);
              translationCache.set(translationCacheKey, translatedText);
              return {
                segmentId: segment.segmentId,
                translatedText,
                skipped: false,
                reason: null
              };
            } catch (error) {
              console.warn("[Page Translator] Segment translation failed", {
                segmentId: segment.segmentId,
                sourceLanguage: normalizedSourceLanguage,
                targetLanguage: normalizedTargetLanguage,
                error: error instanceof Error ? error.message : String(error)
              });

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
    translationCacheMissCount: 0
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

function createStatsFromResults(extraction, detectedLanguages, translatedSegments) {
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
  console.info("[Page Translator] Restore stats", translationState.lastStats);
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
  const extraction = collectTranslatableTextSegments(document.body);
  lastExtraction = extraction;

  console.info("[Page Translator] Extraction stats", {
    totalTextNodesFound: extraction.totalTextNodesFound,
    totalSkippedNodes: extraction.totalSkippedNodes,
    extractedSegmentCount: extraction.segments.length
  });

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
      cacheMetrics: { ...translationSessionCache.metrics }
    };

    return;
  }

  const provider = createTranslationProvider();
  const normalizedTargetLanguage = targetLanguage || DEFAULT_TARGET_LANGUAGE;
  const capability = await provider.checkAvailability(normalizedTargetLanguage);
  validateCapability(capability);

  const detectedLanguages = await provider.detectLanguages(extraction.segments);
  const detectedLanguagesBySegmentId = new Map(
    detectedLanguages.map((result) => [result.segmentId, result.language])
  );

  const translatedSegments = await provider.translateSegments(
    extraction.segments,
    normalizedTargetLanguage,
    detectedLanguagesBySegmentId
  );

  const { translatedNodes, updatedNodeCount, unchangedNodeCount } = writeTranslatedTextToNodes(
    extraction,
    translatedSegments
  );
  const stats = createStatsFromResults(extraction, detectedLanguages, translatedSegments);

  translationState.isTranslated = true;
  translationState.targetLanguage = normalizedTargetLanguage;
  translationState.translatedNodes = translatedNodes;
  translationState.lastError = null;
  translationState.lastAppliedTargetLanguage = normalizedTargetLanguage;
  translationState.lastStats = stats;

  console.info("[Page Translator] Cache metrics", translationSessionCache.metrics);

  console.info("[Page Translator] DOM write stats", {
    updatedNodeCount,
    unchangedNodeCount
  });

  console.info("[Page Translator] Translation stats", stats);
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

        console.warn("[Page Translator] Translation request failed", {
          error: errorMessage,
          stats: translationState.lastStats
        });

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
