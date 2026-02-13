import { describe, it, expect } from 'vitest';
import { analyze, buildComparison, findDuplicates, buildSpaceAnalysis } from '../src/scanner/analyzer.js';

// --- Helpers to build test fixtures ---

function makeFile(overrides = {}) {
  return {
    path: 'file.txt',
    absolutePath: '/root/file.txt',
    name: 'file.txt',
    extension: 'txt',
    size: 100,
    sizeHuman: '100 B',
    hash: '',
    modified: '2025-01-01T00:00:00.000Z',
    created: '2025-01-01T00:00:00.000Z',
    isDirectory: false,
    isSymlink: false,
    permissions: 'rw-r--r--',
    depth: 0,
    ...overrides,
  };
}

function makeScan(files = [], dirs = [], root = '/test') {
  return {
    root,
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

// --- buildComparison ---

describe('buildComparison', () => {
  it('identifies files only in left', () => {
    const left = makeScan([makeFile({ path: 'a.txt', hash: 'abc' })]);
    const right = makeScan([]);
    const result = buildComparison(left, right);

    expect(result.onlyLeft).toHaveLength(1);
    expect(result.onlyLeft[0].path).toBe('a.txt');
    expect(result.onlyRight).toHaveLength(0);
    expect(result.common).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it('identifies files only in right', () => {
    const left = makeScan([]);
    const right = makeScan([makeFile({ path: 'b.txt', hash: 'def' })]);
    const result = buildComparison(left, right);

    expect(result.onlyRight).toHaveLength(1);
    expect(result.onlyRight[0].path).toBe('b.txt');
    expect(result.onlyLeft).toHaveLength(0);
  });

  it('identifies identical files by matching hash', () => {
    const left = makeScan([makeFile({ path: 'same.txt', hash: 'aaa' })]);
    const right = makeScan([makeFile({ path: 'same.txt', hash: 'aaa' })]);
    const result = buildComparison(left, right);

    expect(result.common).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
  });

  it('identifies modified files with different hashes', () => {
    const left = makeScan([makeFile({ path: 'mod.txt', hash: 'aaa', modified: '2025-01-01T00:00:00.000Z' })]);
    const right = makeScan([makeFile({ path: 'mod.txt', hash: 'bbb', modified: '2025-02-01T00:00:00.000Z' })]);
    const result = buildComparison(left, right);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].relativePath).toBe('mod.txt');
    expect(result.modified[0].newerSide).toBe('right');
  });

  it('treats files without hashes as modified', () => {
    const left = makeScan([makeFile({ path: 'x.txt', hash: '' })]);
    const right = makeScan([makeFile({ path: 'x.txt', hash: '' })]);
    const result = buildComparison(left, right);

    expect(result.modified).toHaveLength(1);
    expect(result.common).toHaveLength(0);
  });

  it('handles mixed scenario correctly', () => {
    const left = makeScan([
      makeFile({ path: 'a.txt', hash: 'h1' }),
      makeFile({ path: 'b.txt', hash: 'h2' }),
      makeFile({ path: 'c.txt', hash: 'h3' }),
    ]);
    const right = makeScan([
      makeFile({ path: 'b.txt', hash: 'h2' }),
      makeFile({ path: 'c.txt', hash: 'h3-changed' }),
      makeFile({ path: 'd.txt', hash: 'h4' }),
    ]);
    const result = buildComparison(left, right);

    expect(result.onlyLeft).toHaveLength(1);
    expect(result.onlyLeft[0].path).toBe('a.txt');
    expect(result.onlyRight).toHaveLength(1);
    expect(result.onlyRight[0].path).toBe('d.txt');
    expect(result.common).toHaveLength(1);
    expect(result.common[0].path).toBe('b.txt');
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].relativePath).toBe('c.txt');
  });
});

// --- findDuplicates ---

describe('findDuplicates', () => {
  it('returns empty array when no duplicates exist', () => {
    const files = [
      makeFile({ path: 'a.txt', hash: 'h1', size: 100 }),
      makeFile({ path: 'b.txt', hash: 'h2', size: 200 }),
    ];
    expect(findDuplicates(files)).toHaveLength(0);
  });

  it('groups files with same hash', () => {
    const files = [
      makeFile({ path: 'a.txt', hash: 'same', size: 500 }),
      makeFile({ path: 'b.txt', hash: 'same', size: 500 }),
      makeFile({ path: 'c.txt', hash: 'same', size: 500 }),
    ];
    const result = findDuplicates(files);

    expect(result).toHaveLength(1);
    expect(result[0].files).toHaveLength(3);
    expect(result[0].wastedSpace).toBe(1000); // 500 * (3-1)
    expect(result[0].hash).toBe('same');
  });

  it('skips files without hashes', () => {
    const files = [
      makeFile({ path: 'a.txt', hash: '', size: 100 }),
      makeFile({ path: 'b.txt', hash: '', size: 100 }),
    ];
    expect(findDuplicates(files)).toHaveLength(0);
  });

  it('skips files with not-hashed prefix', () => {
    const files = [
      makeFile({ path: 'a.txt', hash: 'not-hashed:too-large', size: 100 }),
      makeFile({ path: 'b.txt', hash: 'not-hashed:too-large', size: 100 }),
    ];
    expect(findDuplicates(files)).toHaveLength(0);
  });

  it('skips files with error hash prefix', () => {
    const files = [
      makeFile({ path: 'a.txt', hash: 'error:EACCES', size: 100 }),
      makeFile({ path: 'b.txt', hash: 'error:EACCES', size: 100 }),
    ];
    expect(findDuplicates(files)).toHaveLength(0);
  });

  it('sorts groups by wasted space descending', () => {
    const files = [
      makeFile({ path: 'a.txt', hash: 'small', size: 10 }),
      makeFile({ path: 'b.txt', hash: 'small', size: 10 }),
      makeFile({ path: 'c.txt', hash: 'big', size: 1000 }),
      makeFile({ path: 'd.txt', hash: 'big', size: 1000 }),
    ];
    const result = findDuplicates(files);

    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe('big');
    expect(result[1].hash).toBe('small');
  });
});

// --- buildSpaceAnalysis ---

describe('buildSpaceAnalysis', () => {
  it('groups files by extension', () => {
    const scan = makeScan([
      makeFile({ path: 'a.js', extension: 'js', size: 100 }),
      makeFile({ path: 'b.js', extension: 'js', size: 200 }),
      makeFile({ path: 'c.css', extension: 'css', size: 50 }),
    ]);
    const result = buildSpaceAnalysis(scan);

    expect(result.byExtension).toHaveLength(2);
    expect(result.byExtension[0].extension).toBe('js');
    expect(result.byExtension[0].totalSize).toBe(300);
    expect(result.byExtension[0].count).toBe(2);
  });

  it('groups files by directory', () => {
    const scan = makeScan([
      makeFile({ path: 'src/a.js', size: 100 }),
      makeFile({ path: 'src/b.js', size: 200 }),
      makeFile({ path: 'lib/c.js', size: 50 }),
    ]);
    const result = buildSpaceAnalysis(scan);

    expect(result.byDirectory).toHaveLength(2);
    expect(result.byDirectory[0].path).toBe('src');
    expect(result.byDirectory[0].totalSize).toBe(300);
  });

  it('identifies largest files (top 50)', () => {
    const files = Array.from({ length: 60 }, (_, i) =>
      makeFile({ path: `file${i}.txt`, name: `file${i}.txt`, size: i * 10 })
    );
    const scan = makeScan(files);
    const result = buildSpaceAnalysis(scan);

    expect(result.largestFiles).toHaveLength(50);
    expect(result.largestFiles[0].size).toBe(590);
  });

  it('identifies empty files', () => {
    const scan = makeScan([
      makeFile({ path: 'empty.txt', size: 0 }),
      makeFile({ path: 'full.txt', size: 100 }),
    ]);
    const result = buildSpaceAnalysis(scan);

    expect(result.emptyFiles).toHaveLength(1);
    expect(result.emptyFiles[0].path).toBe('empty.txt');
  });

  it('identifies empty directories', () => {
    const scan = makeScan(
      [makeFile({ path: 'src/a.js' })],
      ['src', 'empty-dir'],
    );
    const result = buildSpaceAnalysis(scan);

    expect(result.emptyDirs).toContain('empty-dir');
  });

  it('builds treemap data', () => {
    const scan = makeScan(
      [makeFile({ path: 'a.js', name: 'a.js', size: 100 })],
      [],
      '/project',
    );
    const result = buildSpaceAnalysis(scan);

    expect(result.treemapData).toBeDefined();
    expect(result.treemapData.name).toBe('project');
    expect(result.treemapData.size).toBe(100);
  });

  it('uses (no ext) for files without extension', () => {
    const scan = makeScan([
      makeFile({ path: 'Makefile', extension: '', size: 50 }),
    ]);
    const result = buildSpaceAnalysis(scan);

    expect(result.byExtension[0].extension).toBe('(no ext)');
  });
});

// --- analyze (integration) ---

describe('analyze', () => {
  it('produces space analysis for single-directory mode', () => {
    const scan = makeScan([
      makeFile({ path: 'a.txt', hash: 'h1', size: 100 }),
    ]);
    const result = analyze(scan, null);

    expect(result.spaceLeft).toBeDefined();
    expect(result.spaceRight).toBeUndefined();
    expect(result.comparison).toBeUndefined();
    expect(result.duplicatesAll).toBeDefined();
  });

  it('produces comparison and both spaces for dual-directory mode', () => {
    const left = makeScan([makeFile({ path: 'a.txt', hash: 'h1' })]);
    const right = makeScan([makeFile({ path: 'a.txt', hash: 'h1' })]);
    const result = analyze(left, right);

    expect(result.spaceLeft).toBeDefined();
    expect(result.spaceRight).toBeDefined();
    expect(result.comparison).toBeDefined();
    expect(result.duplicatesAll).toBeDefined();
  });

  it('finds cross-directory duplicates', () => {
    const left = makeScan([makeFile({ path: 'a.txt', hash: 'same', size: 200 })]);
    const right = makeScan([makeFile({ path: 'b.txt', hash: 'same', size: 200 })]);
    const result = analyze(left, right);

    expect(result.duplicatesAll).toHaveLength(1);
    expect(result.duplicatesAll[0].files).toHaveLength(2);
  });
});
