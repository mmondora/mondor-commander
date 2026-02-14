const sharp = require('sharp');

class ThumbnailCache {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.cache = new Map();
  }

  get(key) {
    const val = this.cache.get(key);
    if (!val) return null;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key, buffer) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Delete oldest entry
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, buffer);
  }
}

const thumbCache = new ThumbnailCache(500);
const previewCache = new ThumbnailCache(100);

async function generateThumbnail(absolutePath, size = 200) {
  const cacheKey = `${absolutePath}:${size}`;
  const cached = thumbCache.get(cacheKey);
  if (cached) return cached;

  const buffer = await sharp(absolutePath)
    .rotate()
    .resize(size, size, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toBuffer();

  thumbCache.set(cacheKey, buffer);
  return buffer;
}

async function generatePreview(absolutePath, size = 1200) {
  const cacheKey = `${absolutePath}:${size}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  const buffer = await sharp(absolutePath)
    .rotate()
    .resize(size, size, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer();

  previewCache.set(cacheKey, buffer);
  return buffer;
}

module.exports = { generateThumbnail, generatePreview, ThumbnailCache };
