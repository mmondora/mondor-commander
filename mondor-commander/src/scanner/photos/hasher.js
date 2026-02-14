const sharp = require('sharp');

const PHOTO_CONCURRENCY = 4;

// ─── DCT coefficients (precomputed for 32x32) ───
const DCT_COS = new Float64Array(32 * 32);
for (let k = 0; k < 32; k++) {
  for (let n = 0; n < 32; n++) {
    DCT_COS[k * 32 + n] = Math.cos((Math.PI / 32) * (n + 0.5) * k);
  }
}

function computePHash(pixels32x32) {
  // Apply 2D DCT to 32x32 grayscale image
  // Step 1: DCT on rows
  const rowDCT = new Float64Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let k = 0; k < 32; k++) {
      let sum = 0;
      for (let n = 0; n < 32; n++) {
        sum += pixels32x32[y * 32 + n] * DCT_COS[k * 32 + n];
      }
      rowDCT[y * 32 + k] = sum;
    }
  }

  // Step 2: DCT on columns
  const dct = new Float64Array(32 * 32);
  for (let x = 0; x < 32; x++) {
    for (let k = 0; k < 32; k++) {
      let sum = 0;
      for (let n = 0; n < 32; n++) {
        sum += rowDCT[n * 32 + x] * DCT_COS[k * 32 + n];
      }
      dct[k * 32 + x] = sum;
    }
  }

  // Step 3: Take top-left 8x8 low-frequency coefficients (excluding DC at [0,0])
  const coeffs = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (y === 0 && x === 0) continue; // skip DC
      coeffs.push(dct[y * 32 + x]);
    }
  }

  // Step 4: Compute median of 63 AC coefficients
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted[31]; // median of 63 values

  // Step 5: Build 64-bit hash (first bit is always 0 for DC placeholder)
  let hash = BigInt(0);
  for (let i = 0; i < 63; i++) {
    if (coeffs[i] > median) {
      hash |= BigInt(1) << BigInt(63 - 1 - i);
    }
  }

  return hash.toString(16).padStart(16, '0');
}

function computeDHash(pixels9x8) {
  // 9 pixels wide × 8 rows high
  // For each row: compare adjacent pixels, bit=1 if left > right
  let hash = BigInt(0);
  let bit = 63;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels9x8[y * 9 + x];
      const right = pixels9x8[y * 9 + x + 1];
      if (left > right) {
        hash |= BigInt(1) << BigInt(bit);
      }
      bit--;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

function computeAHash(pixels8x8) {
  // Average all 64 pixel values
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    sum += pixels8x8[i];
  }
  const avg = sum / 64;

  // Each bit: 1 if pixel > average
  let hash = BigInt(0);
  for (let i = 0; i < 64; i++) {
    if (pixels8x8[i] > avg) {
      hash |= BigInt(1) << BigInt(63 - i);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

function hammingDistance(hash1, hash2) {
  const a = BigInt('0x' + hash1);
  const b = BigInt('0x' + hash2);
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

async function computePhotoHashes(absolutePath) {
  try {
    const img = sharp(absolutePath).rotate(); // auto-apply EXIF orientation

    const [buf32, buf9x8, buf8x8] = await Promise.all([
      img.clone().resize(32, 32, { fit: 'fill' }).grayscale().raw().toBuffer(),
      img.clone().resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer(),
      img.clone().resize(8, 8, { fit: 'fill' }).grayscale().raw().toBuffer(),
    ]);

    return {
      pHash: computePHash(buf32),
      dHash: computeDHash(buf9x8),
      aHash: computeAHash(buf8x8),
    };
  } catch {
    return null;
  }
}

async function hashPhotos(photos, onProgress) {
  let completed = 0;
  const total = photos.length;
  const queue = [...photos];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;

      const hashes = await computePhotoHashes(file.absolutePath);
      if (hashes) {
        if (!file.photo) file.photo = {};
        file.photo.hashes = hashes;
      }

      completed++;
      if (onProgress && completed % 10 === 0) {
        onProgress(completed, total);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < PHOTO_CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (onProgress) onProgress(total, total);
}

module.exports = { computePHash, computeDHash, computeAHash, hammingDistance, computePhotoHashes, hashPhotos };
