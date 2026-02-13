const crypto = require('crypto');
const fs = require('fs');

const CHUNK_SIZE = 64 * 1024; // 64KB
const CONCURRENCY = 10;

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

async function hashFiles(files, maxFileSize, onProgress) {
  let completed = 0;
  const total = files.length;

  // Process files in batches with concurrency limit
  const queue = [...files];
  const workers = [];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;

      if (file.size > maxFileSize) {
        file.hash = 'not-hashed:too-large';
      } else if (file.size === 0) {
        file.hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // SHA-256 of empty
      } else {
        try {
          file.hash = await hashFile(file.absolutePath);
        } catch (err) {
          file.hash = `error:${err.code || 'unknown'}`;
        }
      }

      completed++;
      if (onProgress && completed % 50 === 0) {
        onProgress(completed, total);
      }
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (onProgress) onProgress(total, total);

  return files;
}

module.exports = { hashFile, hashFiles };
