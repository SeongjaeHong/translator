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
  translatedNodes: []
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
  // Keep text that includes any unicode letter/number characters.
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

  const segments = [...dedupedSegmentsByText.values()];

  return {
    totalTextNodesFound,
    totalSkippedNodes,
    segments,
    nodeMappings
  };
}

async function applyTranslation(extraction, targetLanguage) {
  const provider = createTranslationProvider();
  const capability = await provider.checkAvailability();

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

  const translatedSegmentsById = new Map(
    translatedSegments.map((segment) => [segment.segmentId, segment.translatedText])
  );

  const translatedNodes = [];

  extraction.segments.forEach((segment) => {
    const translatedText = translatedSegmentsById.get(segment.segmentId);

    segment.nodeMappingIndexes.forEach((mappingIndex) => {
      const nodeMapping = extraction.nodeMappings[mappingIndex];
      if (!nodeMapping?.textNode) {
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

  translationState.isTranslated = true;
  translationState.targetLanguage = targetLanguage;
  translationState.translatedNodes = translatedNodes;
}

function restoreOriginalText() {
  translationState.translatedNodes.forEach((nodeState) => {
    if (!nodeState.textNode) {
      return;
    }

    nodeState.textNode.nodeValue = nodeState.originalText;
  });

  translationState.isTranslated = false;
  translationState.targetLanguage = null;
  translationState.translatedNodes = [];
}

async function onToggleTranslationRequested(targetLanguage) {
  if (translationState.isTranslated) {
    restoreOriginalText();
    console.info("[Page Translator] Restored original page text");
    return;
  }

  const extraction = collectTranslatableTextSegments(document.body);
  lastExtraction = extraction;
  await applyTranslation(extraction, targetLanguage);

  console.info(
    "[Page Translator] Applied built-in Chrome translation to DOM text segments",
    {
      targetLanguage,
      totalTextNodesFound: extraction.totalTextNodesFound,
      totalTextSegmentsExtracted: extraction.segments.length,
      totalSkippedNodes: extraction.totalSkippedNodes,
      totalTranslatedNodes: translationState.translatedNodes.length
    }
  );
}

function getSerializableTranslationState() {
  return {
    isTranslated: translationState.isTranslated,
    targetLanguage: translationState.targetLanguage,
    totalTranslatedNodes: translationState.translatedNodes.length
  };
}

async function onPageTranslationActionRequested(action, targetLanguage) {
  if (action === "restore") {
    if (translationState.isTranslated) {
      restoreOriginalText();
      console.info("[Page Translator] Restored original page text");
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
        console.warn("[Page Translator] Translation request failed", error);
        sendResponse(getSerializableTranslationState());
      });

    return true;
  }
});

// Exposed for console-level manual checks while iterating on extraction quality.
window.__pageTranslatorDebug = {
  collectTranslatableTextSegments,
  getLastExtraction: () => lastExtraction,
  getTranslationState: getSerializableTranslationState
};
