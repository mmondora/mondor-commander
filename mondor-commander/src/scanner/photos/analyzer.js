const { extractExif } = require('./detector.js');
const { hashPhotos } = require('./hasher.js');
const { findVisualDuplicates } = require('./visual-dedup.js');

async function analyzePhotos(scanLeft, scanRight, threshold, onProgress) {
  // Collect all photo files from both scans
  const leftPhotos = scanLeft ? scanLeft.files.filter(f => f.isPhoto) : [];
  const rightPhotos = scanRight ? scanRight.files.filter(f => f.isPhoto) : [];

  // Tag files with their side for visual duplicate grouping
  leftPhotos.forEach(f => { f._side = 'left'; });
  rightPhotos.forEach(f => { f._side = 'right'; });

  const allPhotos = [...leftPhotos, ...rightPhotos];
  if (allPhotos.length < 5) return null;

  const total = allPhotos.length;
  let phase = 'exif';

  // Phase 1: Extract EXIF for all photos
  if (onProgress) onProgress(0, total, 'exif');
  let exifDone = 0;
  const EXIF_CONCURRENCY = 8;
  const exifQueue = [...allPhotos];

  async function exifWorker() {
    while (exifQueue.length > 0) {
      const file = exifQueue.shift();
      if (!file) break;
      const meta = await extractExif(file.absolutePath);
      if (!file.photo) file.photo = {};
      file.photo.meta = meta;
      exifDone++;
      if (onProgress && exifDone % 10 === 0) {
        onProgress(exifDone, total, 'exif');
      }
    }
  }

  const exifWorkers = [];
  for (let i = 0; i < EXIF_CONCURRENCY; i++) {
    exifWorkers.push(exifWorker());
  }
  await Promise.all(exifWorkers);

  // Phase 2: Compute perceptual hashes
  if (onProgress) onProgress(0, total, 'hashing');
  await hashPhotos(allPhotos, (done, t) => {
    if (onProgress) onProgress(done, t, 'hashing');
  });

  // Phase 3: Find visual duplicates
  if (onProgress) onProgress(0, 1, 'dedup');
  const visualDuplicates = findVisualDuplicates(allPhotos, threshold);
  if (onProgress) onProgress(1, 1, 'dedup');

  // Build stats
  const statsLeft = buildPhotoStats(leftPhotos);
  const statsRight = rightPhotos.length > 0 ? buildPhotoStats(rightPhotos) : null;

  const totalWasted = visualDuplicates.reduce((s, g) => s + g.wastedSize, 0);

  return {
    totalPhotos: allPhotos.length,
    leftPhotos: leftPhotos.length,
    rightPhotos: rightPhotos.length,
    statsLeft,
    statsRight,
    visualDuplicates,
    totalVisualDuplicateGroups: visualDuplicates.length,
    totalWastedSize: totalWasted,
    totalWastedHuman: humanSize(totalWasted),
    threshold,
  };
}

function buildPhotoStats(photos) {
  if (photos.length === 0) return null;

  const totalSize = photos.reduce((s, p) => s + p.size, 0);
  const byFormat = {};
  const byCamera = {};
  const byYear = {};
  let withGps = 0;
  let withoutGps = 0;
  let minDate = null, maxDate = null;
  let minRes = Infinity, maxRes = 0;

  for (const p of photos) {
    // By format
    const ext = p.extension;
    byFormat[ext] = (byFormat[ext] || 0) + 1;

    // By camera / year / GPS from EXIF
    const meta = p.photo && p.photo.meta;
    if (meta && meta.exif) {
      if (meta.exif.camera) {
        byCamera[meta.exif.camera] = (byCamera[meta.exif.camera] || 0) + 1;
      }
      if (meta.exif.dateTaken) {
        const d = new Date(meta.exif.dateTaken);
        const year = d.getFullYear();
        if (!isNaN(year)) {
          byYear[year] = (byYear[year] || 0) + 1;
          if (!minDate || d < minDate) minDate = d;
          if (!maxDate || d > maxDate) maxDate = d;
        }
      }
      if (meta.exif.gps) withGps++;
      else withoutGps++;

      if (meta.megapixels > 0) {
        if (meta.megapixels < minRes) minRes = meta.megapixels;
        if (meta.megapixels > maxRes) maxRes = meta.megapixels;
      }
    } else {
      withoutGps++;
    }
  }

  return {
    totalPhotos: photos.length,
    totalPhotoSize: totalSize,
    totalPhotoSizeHuman: humanSize(totalSize),
    byFormat,
    byCamera,
    byYear,
    resolutionRange: minRes === Infinity ? null : { min: minRes, max: maxRes },
    withGps,
    withoutGps,
    dateRange: minDate ? { min: minDate.toISOString(), max: maxDate.toISOString() } : null,
  };
}

function humanSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

module.exports = { analyzePhotos, buildPhotoStats };
