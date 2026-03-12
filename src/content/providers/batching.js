export function createChunks(items, chunkSize) {
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
