import { MESSAGE_TYPES } from "../shared/messages.js";
import { createTranslationProvider } from "./providers/provider-factory.js";

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

const translationState = {
  isTranslated: false,
  targetLanguage: null,
  translatedNodes: [],
  lastError: null,
  lastStats: null
};

function isHiddenElement(element) {
  if (!element) {
    return false;
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return true;
  }

  const style = window.getComputedStyle(element);

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  ) {
    return true;
  }

  return false;
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

  return {
    extractionCount: extraction.segments.length,
    detectedLanguageCount: detectedCount,
    translatedCount,
    skippedCount,
    restoredCount: 0
  };
}

function writeTranslatedTextToNodes(extraction, translatedSegments) {
  const translatedSegmentsById = new Map(
    translatedSegments.map((segment) => [segment.segmentId, segment.translatedText])
  );

  const translatedNodes = [];

  extraction.segments.forEach((segment) => {
    const translatedText = translatedSegmentsById.get(segment.segmentId);

    segment.nodeMappingIndexes.forEach((mappingIndex) => {
      const nodeMapping = extraction.nodeMappings[mappingIndex];
      if (!nodeMapping?.textNode || typeof translatedText !== "string") {
        return;
      }

      nodeMapping.textNode.nodeValue = translatedText;
      translatedNodes.push({
        textNode: nodeMapping.textNode,
        originalText: nodeMapping.originalText,
        translatedText
      });
    });
  });

  return translatedNodes;
}

async function applyTranslation(extraction, targetLanguage) {
  const provider = createTranslationProvider();
  const capability = await provider.checkAvailability(targetLanguage);

  if (!capability.isAvailable) {
    throw new Error(capability.reason ?? "Built-in translation APIs are unavailable.");
  }

  const detectedLanguages = await provider.detectLanguages(extraction.segments);
  const detectedLanguagesBySegmentId = new Map(
    detectedLanguages.map((result) => [result.segmentId, result.language])
  );

  const translatedSegments = await provider.translateSegments(
    extraction.segments,
    targetLanguage,
    detectedLanguagesBySegmentId
  );

  const translatedNodes = writeTranslatedTextToNodes(extraction, translatedSegments);
  const stats = createStatsFromResults(extraction, detectedLanguages, translatedSegments);

  translationState.isTranslated = true;
  translationState.targetLanguage = targetLanguage;
  translationState.translatedNodes = translatedNodes;
  translationState.lastError = null;
  translationState.lastStats = stats;

  console.info("[Page Translator] Translation stats", stats);
}

function restoreOriginalText() {
  let restoredCount = 0;

  translationState.translatedNodes.forEach((nodeState) => {
    if (!nodeState.textNode) {
      return;
    }

    nodeState.textNode.nodeValue = nodeState.originalText;
    restoredCount += 1;
  });

  translationState.isTranslated = false;
  translationState.targetLanguage = null;
  translationState.translatedNodes = [];
  translationState.lastError = null;
  translationState.lastStats = {
    extractionCount: lastExtraction?.segments.length ?? 0,
    detectedLanguageCount: translationState.lastStats?.detectedLanguageCount ?? 0,
    translatedCount: 0,
    skippedCount: 0,
    restoredCount
  };

  console.info("[Page Translator] Restore stats", translationState.lastStats);
}

async function onToggleTranslationRequested(targetLanguage) {
  if (translationState.isTranslated) {
    restoreOriginalText();
    return;
  }

  const extraction = collectTranslatableTextSegments(document.body);
  lastExtraction = extraction;

  await applyTranslation(extraction, targetLanguage);
}

function getSerializableTranslationState() {
  return {
    isTranslated: translationState.isTranslated,
    targetLanguage: translationState.targetLanguage,
    totalTranslatedNodes: translationState.translatedNodes.length,
    lastError: translationState.lastError,
    lastStats: translationState.lastStats
  };
}

async function onPageTranslationActionRequested(action, targetLanguage) {
  if (action === "restore") {
    if (translationState.isTranslated) {
      restoreOriginalText();
    }

    return getSerializableTranslationState();
  }

  if (action === "translate") {
    if (!translationState.isTranslated) {
      await onToggleTranslationRequested(targetLanguage);
    }

    return getSerializableTranslationState();
  }

  await onToggleTranslationRequested(targetLanguage);
  return getSerializableTranslationState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_PAGE_TRANSLATION_STATE_REQUESTED) {
    sendResponse(getSerializableTranslationState());
    return;
  }

  if (message?.type === MESSAGE_TYPES.PAGE_TRANSLATION_ACTION_REQUESTED) {
    const action = message.payload?.action ?? "toggle";
    const language = message.payload?.targetLanguage ?? "ko";

    onPageTranslationActionRequested(action, language)
      .then((state) => sendResponse(state))
      .catch((error) => {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Built-in translation is unavailable in this environment.";

        translationState.lastError = errorMessage;
        translationState.lastStats = {
          extractionCount: lastExtraction?.segments.length ?? 0,
          detectedLanguageCount: 0,
          translatedCount: 0,
          skippedCount: lastExtraction?.segments.length ?? 0,
          restoredCount: 0
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
