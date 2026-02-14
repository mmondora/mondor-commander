const { hammingDistance } = require('./hasher.js');

const THRESHOLDS = { exact: 5, similar: 15, loose: 25 };

const FORMAT_WEIGHTS = {
  nef: 1.5, cr2: 1.5, arw: 1.5, dng: 1.5, orf: 1.5, rw2: 1.5, raf: 1.5,
  heic: 1.2, heif: 1.2,
  tiff: 1.1, tif: 1.1, avif: 1.1,
  jpg: 1.0, jpeg: 1.0,
  webp: 0.95,
  png: 0.9,
};

function computeQualityScore(photo) {
  const mp = (photo.photo && photo.photo.meta) ? photo.photo.meta.megapixels : 0;
  const fw = FORMAT_WEIGHTS[photo.extension] || 1.0;
  const sizeScore = photo.size > 0 ? Math.log2(photo.size) / 20 : 0;
  return (mp || 1) * fw * (sizeScore || 0.5);
}

function resolveThreshold(threshold) {
  if (typeof threshold === 'number') return threshold;
  return THRESHOLDS[threshold] || THRESHOLDS.exact;
}

function findVisualDuplicates(photos, threshold) {
  const maxDist = resolveThreshold(threshold);

  // Filter to photos that have hashes
  const hashed = photos.filter(p => p.photo && p.photo.hashes);
  if (hashed.length < 2) return [];

  // Bucket pre-filtering: group by first 2 hex chars of aHash
  const buckets = new Map();
  for (let i = 0; i < hashed.length; i++) {
    const key = hashed[i].photo.hashes.aHash.substring(0, 2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }

  // Generate adjacent bucket keys for comparison
  function getAdjacentKeys(hexKey) {
    const val = parseInt(hexKey, 16);
    const keys = [hexKey];
    for (let d = -2; d <= 2; d++) {
      if (d === 0) continue;
      const adj = (val + d + 256) % 256;
      keys.push(adj.toString(16).padStart(2, '0'));
    }
    return keys;
  }

  // Union-Find for clustering
  const parent = new Int32Array(hashed.length);
  const rank = new Int32Array(hashed.length);
  for (let i = 0; i < hashed.length; i++) parent[i] = i;

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
  }

  // Compare within same + adjacent buckets
  const compared = new Set();
  for (const [key, indices] of buckets) {
    const adjKeys = getAdjacentKeys(key);
    const candidates = new Set(indices);
    for (const ak of adjKeys) {
      const adjBucket = buckets.get(ak);
      if (adjBucket) adjBucket.forEach(i => candidates.add(i));
    }

    const arr = [...candidates];
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const i = arr[a], j = arr[b];
        const pairKey = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (compared.has(pairKey)) continue;
        compared.add(pairKey);

        const h1 = hashed[i].photo.hashes;
        const h2 = hashed[j].photo.hashes;

        // Consensus: pair is duplicate if >= 2 of 3 hashes are under threshold
        let matches = 0;
        if (hammingDistance(h1.pHash, h2.pHash) <= maxDist) matches++;
        if (hammingDistance(h1.dHash, h2.dHash) <= maxDist) matches++;
        if (hammingDistance(h1.aHash, h2.aHash) <= maxDist) matches++;

        if (matches >= 2) {
          union(i, j);
        }
      }
    }
  }

  // Cluster into groups
  const groups = new Map();
  for (let i = 0; i < hashed.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(hashed[i]);
  }

  // Build result: only groups with 2+ members
  const result = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;

    // Compute quality scores
    const scored = members.map(m => ({ file: m, score: computeQualityScore(m) }));
    scored.sort((a, b) => b.score - a.score);

    const bestVersion = scored[0].file;
    const totalSize = members.reduce((s, m) => s + m.size, 0);
    const wastedSize = totalSize - bestVersion.size;

    result.push({
      id: `vdup-${result.length}`,
      members: members.map(m => ({
        path: m.path,
        absolutePath: m.absolutePath,
        side: m._side || null,
        size: m.size,
        sizeHuman: m.sizeHuman,
        extension: m.extension,
        hashes: m.photo.hashes,
        meta: m.photo.meta || null,
        qualityScore: computeQualityScore(m),
        isBest: m === bestVersion,
      })),
      bestVersion: bestVersion.path,
      totalSize,
      wastedSize,
    });
  }

  // Sort by wasted size descending
  result.sort((a, b) => b.wastedSize - a.wastedSize);
  return result;
}

module.exports = { findVisualDuplicates, computeQualityScore, THRESHOLDS, FORMAT_WEIGHTS, resolveThreshold };
