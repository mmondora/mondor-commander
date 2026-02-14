const exifr = require('exifr');
const path = require('path');

const PHOTO_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tiff', 'tif',
  'avif', 'nef', 'cr2', 'arw', 'dng', 'orf', 'rw2', 'raf'
]);

const EXT_TO_FORMAT = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', heic: 'heic', heif: 'heif',
  webp: 'webp', tiff: 'tiff', tif: 'tiff', avif: 'avif',
  nef: 'raw/nef', cr2: 'raw/cr2', arw: 'raw/arw', dng: 'raw/dng',
  orf: 'raw/orf', rw2: 'raw/rw2', raf: 'raw/raf',
};

function isPhoto(fileEntry) {
  return PHOTO_EXTENSIONS.has(fileEntry.extension);
}

async function extractExif(absolutePath) {
  try {
    const data = await exifr.parse(absolutePath, {
      pick: [
        'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight',
        'DateTimeOriginal', 'CreateDate',
        'Make', 'Model', 'LensModel', 'LensMake',
        'FocalLength', 'FNumber', 'ISO', 'ExposureTime',
        'GPSLatitude', 'GPSLongitude',
        'Orientation',
      ],
    });

    if (!data) return null;

    const width = data.ExifImageWidth || data.ImageWidth || 0;
    const height = data.ExifImageHeight || data.ImageHeight || 0;
    const megapixels = width && height ? Math.round((width * height) / 1e6 * 10) / 10 : 0;

    const ext = path.extname(absolutePath).toLowerCase().replace(/^\./, '');
    const format = EXT_TO_FORMAT[ext] || ext;

    const dateTaken = data.DateTimeOriginal || data.CreateDate || null;
    const camera = [data.Make, data.Model].filter(Boolean).join(' ').trim() || null;
    const lens = data.LensModel || null;
    const focalLength = data.FocalLength || null;
    const aperture = data.FNumber || null;
    const iso = data.ISO || null;
    const exposureTime = data.ExposureTime || null;
    const gps = (data.GPSLatitude != null && data.GPSLongitude != null)
      ? { lat: data.GPSLatitude, lng: data.GPSLongitude }
      : null;
    const orientation = data.Orientation || 1;

    return {
      width,
      height,
      megapixels,
      format,
      exif: { dateTaken, camera, lens, focalLength, aperture, iso, exposureTime, gps, orientation },
    };
  } catch {
    return null;
  }
}

module.exports = { PHOTO_EXTENSIONS, isPhoto, extractExif };
