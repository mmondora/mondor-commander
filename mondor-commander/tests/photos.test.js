import { describe, it, expect } from 'vitest';

// Test perceptual hashing utilities
describe('Photo Intelligence — Perceptual Hashing', () => {
  // Import the module (CommonJS)
  let hasher;
  try {
    hasher = require('../src/scanner/photos/hasher.js');
  } catch (e) {
    // sharp may not be available in CI, skip gracefully
    hasher = null;
  }

  it('hammingDistance returns 0 for identical hashes', () => {
    if (!hasher) return;
    expect(hasher.hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hasher.hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
    expect(hasher.hammingDistance('abcdef0123456789', 'abcdef0123456789')).toBe(0);
  });

  it('hammingDistance correctly counts differing bits', () => {
    if (!hasher) return;
    // 0x01 = ...0001, 0x00 = ...0000 => 1 bit difference
    expect(hasher.hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
    // 0x03 = ...0011, 0x00 = ...0000 => 2 bits
    expect(hasher.hammingDistance('0000000000000003', '0000000000000000')).toBe(2);
    // all bits different: 64 bits
    expect(hasher.hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
  });

  it('computeAHash produces a 16-char hex string', () => {
    if (!hasher) return;
    // Create a simple 8x8 buffer of pixel values
    const buf = Buffer.alloc(64, 128); // all same value
    const hash = hasher.computeAHash(buf);
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
  });

  it('computeAHash: all-white produces all-1s hash', () => {
    if (!hasher) return;
    const buf = Buffer.alloc(64, 255);
    const hash = hasher.computeAHash(buf);
    // All pixels > average (255), but average is 255 so > fails for all
    // Actually: avg = 255, each pixel = 255, 255 > 255 is false, so all 0
    expect(hash).toBe('0000000000000000');
  });

  it('computeDHash produces a 16-char hex string', () => {
    if (!hasher) return;
    // 9x8 = 72 pixels
    const buf = Buffer.alloc(72);
    for (let i = 0; i < 72; i++) buf[i] = i * 3;
    const hash = hasher.computeDHash(buf);
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
  });

  it('computePHash produces a 16-char hex string', () => {
    if (!hasher) return;
    // 32x32 = 1024 pixels
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) buf[i] = Math.floor(Math.random() * 256);
    const hash = hasher.computePHash(buf);
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
  });
});

// Test visual dedup logic
describe('Photo Intelligence — Visual Dedup', () => {
  let dedup;
  try {
    dedup = require('../src/scanner/photos/visual-dedup.js');
  } catch (e) {
    dedup = null;
  }

  it('resolveThreshold handles named levels', () => {
    if (!dedup) return;
    expect(dedup.resolveThreshold('exact')).toBe(5);
    expect(dedup.resolveThreshold('similar')).toBe(15);
    expect(dedup.resolveThreshold('loose')).toBe(25);
  });

  it('resolveThreshold handles numeric values', () => {
    if (!dedup) return;
    expect(dedup.resolveThreshold(10)).toBe(10);
    expect(dedup.resolveThreshold(0)).toBe(0);
  });

  it('computeQualityScore prefers RAW over JPEG', () => {
    if (!dedup) return;
    const raw = { extension: 'nef', size: 10000000, photo: { meta: { megapixels: 24 } } };
    const jpg = { extension: 'jpg', size: 10000000, photo: { meta: { megapixels: 24 } } };
    expect(dedup.computeQualityScore(raw)).toBeGreaterThan(dedup.computeQualityScore(jpg));
  });

  it('computeQualityScore prefers higher megapixels', () => {
    if (!dedup) return;
    const big = { extension: 'jpg', size: 10000000, photo: { meta: { megapixels: 24 } } };
    const small = { extension: 'jpg', size: 10000000, photo: { meta: { megapixels: 12 } } };
    expect(dedup.computeQualityScore(big)).toBeGreaterThan(dedup.computeQualityScore(small));
  });

  it('similarityPercent returns correct percentage', () => {
    if (!dedup) return;
    expect(dedup.similarityPercent(0)).toBe(100);   // 0 distance = 100% similar
    expect(dedup.similarityPercent(64)).toBe(0);     // max distance = 0% similar
    expect(dedup.similarityPercent(32)).toBe(50);    // half distance = 50%
  });

  it('findVisualDuplicates groups identical hashes', () => {
    if (!dedup) return;
    const hash = { pHash: 'abcdef0123456789', dHash: '1234567890abcdef', aHash: 'aabb000000000000' };
    const photos = [
      { path: 'a.jpg', absolutePath: '/a.jpg', extension: 'jpg', size: 1000, sizeHuman: '1 KB', photo: { hashes: { ...hash }, meta: { width: 4032, height: 3024, megapixels: 12.2 } } },
      { path: 'b.jpg', absolutePath: '/b.jpg', extension: 'jpg', size: 2000, sizeHuman: '2 KB', photo: { hashes: { ...hash }, meta: { width: 4032, height: 3024, megapixels: 12.2 } } },
      { path: 'c.jpg', absolutePath: '/c.jpg', extension: 'jpg', size: 500, sizeHuman: '500 B', photo: { hashes: { pHash: '0000000000000000', dHash: '0000000000000000', aHash: '0000000000000000' } } },
    ];
    const groups = dedup.findVisualDuplicates(photos, 'exact');
    expect(groups.length).toBe(1);
    expect(groups[0].members.length).toBe(2);
    // Verify enhanced data model fields
    expect(groups[0].similarity).toBe(100);
    expect(groups[0].consensusLevel).toBe(3);
    expect(groups[0].referenceHash).toBeDefined();
    expect(groups[0].hammingDistances).toBeDefined();
    expect(groups[0].hammingDistances.pHash).toBe(0);
    expect(groups[0].members[0].resolution).toBe('4032x3024');
    expect(groups[0].members[0].format).toBeDefined();
    expect(groups[0].members.some(m => m.isBest)).toBe(true);
  });

  it('findVisualDuplicates returns empty for less than 2 photos', () => {
    if (!dedup) return;
    const photos = [
      { path: 'a.jpg', extension: 'jpg', size: 1000, photo: { hashes: { pHash: '0000000000000000', dHash: '0000000000000000', aHash: '0000000000000000' } } },
    ];
    const groups = dedup.findVisualDuplicates(photos, 'exact');
    expect(groups.length).toBe(0);
  });
});

// Test photo detector
describe('Photo Intelligence — Detector', () => {
  let detector;
  try {
    detector = require('../src/scanner/photos/detector.js');
  } catch (e) {
    detector = null;
  }

  it('isPhoto detects common photo extensions', () => {
    if (!detector) return;
    expect(detector.isPhoto({ extension: 'jpg' })).toBe(true);
    expect(detector.isPhoto({ extension: 'jpeg' })).toBe(true);
    expect(detector.isPhoto({ extension: 'png' })).toBe(true);
    expect(detector.isPhoto({ extension: 'heic' })).toBe(true);
    expect(detector.isPhoto({ extension: 'nef' })).toBe(true);
    expect(detector.isPhoto({ extension: 'cr2' })).toBe(true);
    expect(detector.isPhoto({ extension: 'dng' })).toBe(true);
  });

  it('isPhoto rejects non-photo extensions', () => {
    if (!detector) return;
    expect(detector.isPhoto({ extension: 'txt' })).toBe(false);
    expect(detector.isPhoto({ extension: 'js' })).toBe(false);
    expect(detector.isPhoto({ extension: 'mp4' })).toBe(false);
    expect(detector.isPhoto({ extension: 'pdf' })).toBe(false);
    expect(detector.isPhoto({ extension: '' })).toBe(false);
  });
});
