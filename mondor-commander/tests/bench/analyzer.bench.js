import { bench, describe } from 'vitest';
import { analyze, buildComparison, findDuplicates, buildSpaceAnalysis } from '../../src/scanner/analyzer.js';

// --- Generate synthetic datasets ---

function makeFile(i, opts = {}) {
  return {
    path: opts.path || `src/dir${Math.floor(i / 100)}/file${i}.js`,
    absolutePath: `/test/src/dir${Math.floor(i / 100)}/file${i}.js`,
    name: `file${i}.js`,
    extension: ['js', 'ts', 'css', 'json', 'md'][i % 5],
    size: 100 + (i * 37) % 10000,
    sizeHuman: '1.0 KB',
    hash: opts.hash || `hash-${i}`,
    modified: '2025-01-01T00:00:00.000Z',
    created: '2025-01-01T00:00:00.000Z',
    isDirectory: false,
    isSymlink: false,
    permissions: 'rw-r--r--',
    depth: 1,
  };
}

function makeScan(count, opts = {}) {
  const files = Array.from({ length: count }, (_, i) => makeFile(i, opts));
  const dirs = [...new Set(files.map(f => f.path.split('/').slice(0, -1).join('/')))];
  return {
    root: '/test',
    totalFiles: files.length,
    totalDirs: dirs.length,
    totalSize: files.reduce((s, f) => s + f.size, 0),
    totalSizeHuman: '0 B',
    scanDuration: 100,
    files,
    dirs,
    tree: [],
  };
}

// --- 1K file datasets ---
const scan1K = makeScan(1000);
const scan1K_right = makeScan(1000, { hash: undefined });
// Make 30% of right files have different hashes
scan1K_right.files.forEach((f, i) => {
  f.hash = i % 3 === 0 ? `different-hash-${i}` : `hash-${i}`;
});

// --- 10K file datasets ---
const scan10K = makeScan(10000);
const scan10K_right = makeScan(10000);
scan10K_right.files.forEach((f, i) => {
  f.hash = i % 3 === 0 ? `different-hash-${i}` : `hash-${i}`;
});

// --- 10K files with 50% duplicates ---
const scan10K_dupes = makeScan(10000);
scan10K_dupes.files.forEach((f, i) => {
  f.hash = `hash-${i % 5000}`; // 5000 unique hashes -> 5000 duplicate groups of 2
});

// --- Benchmarks ---

describe('buildComparison', () => {
  bench('1K files', () => {
    buildComparison(scan1K, scan1K_right);
  });

  bench('10K files', () => {
    buildComparison(scan10K, scan10K_right);
  });
});

describe('findDuplicates', () => {
  bench('1K files (no duplicates)', () => {
    findDuplicates(scan1K.files);
  });

  bench('10K files (50% duplicates)', () => {
    findDuplicates(scan10K_dupes.files);
  });
});

describe('buildSpaceAnalysis', () => {
  bench('1K files', () => {
    buildSpaceAnalysis(scan1K);
  });

  bench('10K files', () => {
    buildSpaceAnalysis(scan10K);
  });
});

describe('analyze (full pipeline)', () => {
  bench('1K files, dual mode', () => {
    analyze(scan1K, scan1K_right);
  });

  bench('10K files, dual mode', () => {
    analyze(scan10K, scan10K_right);
  });

  bench('10K files, single mode', () => {
    analyze(scan10K, null);
  });
});
