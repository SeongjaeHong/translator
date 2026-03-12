import { MESSAGE_TYPES } from "../shared/messages.js";

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

function createMockTranslation(sourceText, targetLanguage) {
  return `[${targetLanguage}] ${sourceText}`;
}

function applyTranslation(extraction, targetLanguage) {
  const translatedSegmentsById = new Map(
    extraction.segments.map((segment) => [
      segment.segmentId,
      createMockTranslation(segment.sourceText, targetLanguage)
    ])
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

function onToggleTranslationRequested(targetLanguage) {
  if (translationState.isTranslated) {
    restoreOriginalText();
    console.info("[Page Translator] Restored original page text");
    return;
  }

  const extraction = collectTranslatableTextSegments(document.body);
  lastExtraction = extraction;
  applyTranslation(extraction, targetLanguage);

  console.info(
    "[Page Translator] Applied mock translation to DOM text segments",
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

function onPageTranslationActionRequested(action, targetLanguage) {
  if (action === "restore") {
    if (translationState.isTranslated) {
      restoreOriginalText();
      console.info("[Page Translator] Restored original page text");
    }

    return getSerializableTranslationState();
  }

  if (action === "translate") {
    if (!translationState.isTranslated) {
      onToggleTranslationRequested(targetLanguage);
    }

    return getSerializableTranslationState();
  }

  onToggleTranslationRequested(targetLanguage);
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
    sendResponse(onPageTranslationActionRequested(action, language));
  }
});

// Exposed for console-level manual checks while iterating on extraction quality.
window.__pageTranslatorDebug = {
  collectTranslatableTextSegments,
  getLastExtraction: () => lastExtraction,
  getTranslationState: getSerializableTranslationState
};
