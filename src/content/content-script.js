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

function onTranslatePageRequested(targetLanguage) {
  const extraction = collectTranslatableTextSegments(document.body);
  lastExtraction = extraction;

  console.info(
    "[Page Translator] Extracted DOM text segments for translation",
    {
      targetLanguage,
      totalTextNodesFound: extraction.totalTextNodesFound,
      totalTextSegmentsExtracted: extraction.segments.length,
      totalSkippedNodes: extraction.totalSkippedNodes
    }
  );

  // Placeholder for future translation step:
  // - per-segment translation: iterate extraction.segments
  // - batch translation: send extraction.segments.map((s) => s.sourceText)
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== MESSAGE_TYPES.TRANSLATE_PAGE_REQUESTED) {
    return;
  }

  const language = message.payload?.targetLanguage ?? "ko";
  onTranslatePageRequested(language);
});

// Exposed for console-level manual checks while iterating on extraction quality.
window.__pageTranslatorDebug = {
  collectTranslatableTextSegments,
  getLastExtraction: () => lastExtraction
};
