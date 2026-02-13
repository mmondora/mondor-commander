const path = require('path');
const { humanSize } = require('./walker.js');

function analyze(scanLeft, scanRight) {
  const result = {};

  // Build indexes for left
  result.spaceLeft = buildSpaceAnalysis(scanLeft);
  result.duplicatesLeft = findDuplicates(scanLeft.files);

  if (scanRight) {
    result.spaceRight = buildSpaceAnalysis(scanRight);
    result.duplicatesRight = findDuplicates(scanRight.files);
    result.comparison = buildComparison(scanLeft, scanRight);
    // Combined duplicates across both directories
    result.duplicatesAll = findDuplicatesCross(scanLeft, scanRight);
  } else {
    result.duplicatesAll = result.duplicatesLeft;
  }

  return result;
}

function buildComparison(scanLeft, scanRight) {
  const leftByPath = new Map();
  const rightByPath = new Map();

  for (const f of scanLeft.files) leftByPath.set(f.path, f);
  for (const f of scanRight.files) rightByPath.set(f.path, f);

  const onlyLeft = [];
  const onlyRight = [];
  const common = [];
  const modified = [];

  for (const [p, lf] of leftByPath) {
    const rf = rightByPath.get(p);
    if (!rf) {
      onlyLeft.push(lf);
    } else if (lf.hash && rf.hash && lf.hash === rf.hash) {
      common.push(lf);
    } else {
      const leftDate = new Date(lf.modified);
      const rightDate = new Date(rf.modified);
      modified.push({
        relativePath: p,
        left: lf,
        right: rf,
        sizeDiff: rf.size - lf.size,
        newerSide: leftDate > rightDate ? 'left' : 'right',
      });
    }
  }

  for (const [p, rf] of rightByPath) {
    if (!leftByPath.has(p)) {
      onlyRight.push(rf);
    }
  }

  return { onlyLeft, onlyRight, common, modified };
}

function findDuplicates(files) {
  const byHash = new Map();
  for (const f of files) {
    if (!f.hash || f.hash.startsWith('not-hashed') || f.hash.startsWith('error:')) continue;
    if (!byHash.has(f.hash)) byHash.set(f.hash, []);
    byHash.get(f.hash).push(f);
  }

  const groups = [];
  for (const [hash, fileList] of byHash) {
    if (fileList.length > 1) {
      groups.push({
        hash,
        size: fileList[0].size,
        files: fileList,
        wastedSpace: fileList[0].size * (fileList.length - 1),
      });
    }
  }

  groups.sort((a, b) => b.wastedSpace - a.wastedSpace);
  return groups;
}

function findDuplicatesCross(scanLeft, scanRight) {
  const allFiles = [
    ...scanLeft.files.map(f => ({ ...f, side: 'left' })),
    ...scanRight.files.map(f => ({ ...f, side: 'right' })),
  ];
  return findDuplicates(allFiles);
}

function buildSpaceAnalysis(scan) {
  const files = scan.files;

  // By extension
  const extMap = new Map();
  for (const f of files) {
    const ext = f.extension || '(no ext)';
    if (!extMap.has(ext)) extMap.set(ext, { extension: ext, count: 0, totalSize: 0 });
    const entry = extMap.get(ext);
    entry.count++;
    entry.totalSize += f.size;
  }
  const byExtension = [...extMap.values()].sort((a, b) => b.totalSize - a.totalSize);

  // By directory
  const dirMap = new Map();
  for (const f of files) {
    const dir = path.dirname(f.path);
    if (!dirMap.has(dir)) dirMap.set(dir, { path: dir, totalSize: 0, fileCount: 0 });
    const entry = dirMap.get(dir);
    entry.totalSize += f.size;
    entry.fileCount++;
  }
  const byDirectory = [...dirMap.values()].sort((a, b) => b.totalSize - a.totalSize);

  // Treemap data
  const treemapData = buildTreemapData(files, scan.root);

  // Largest files top 50
  const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 50);

  // Empty files
  const emptyFiles = files.filter(f => f.size === 0);

  // Empty dirs
  const dirsWithFiles = new Set(files.map(f => path.dirname(f.path)));
  const emptyDirs = (scan.dirs || []).filter(d => !dirsWithFiles.has(d));

  return { byExtension, byDirectory, treemapData, largestFiles, emptyFiles, emptyDirs };
}

function buildTreemapData(files, rootPath) {
  const root = { name: path.basename(rootPath) || rootPath, size: 0, children: [] };
  const dirNodes = new Map();
  dirNodes.set('.', root);

  for (const f of files) {
    const dir = path.dirname(f.path);
    ensureDirNode(dirNodes, dir, root);

    const parent = dirNodes.get(dir === '.' ? '.' : dir);
    parent.children.push({
      name: f.name,
      size: f.size,
      file: { path: f.path, extension: f.extension, sizeHuman: f.sizeHuman },
    });
    parent.size += f.size;
  }

  // Propagate sizes up
  propagateSizes(root);

  return root;
}

function ensureDirNode(dirNodes, dirPath, root) {
  if (dirPath === '.' || dirNodes.has(dirPath)) return;

  const parts = dirPath.split(path.sep);
  let currentPath = '';
  let parent = root;

  for (const part of parts) {
    currentPath = currentPath ? currentPath + path.sep + part : part;
    if (!dirNodes.has(currentPath)) {
      const node = { name: part, size: 0, children: [] };
      parent.children.push(node);
      dirNodes.set(currentPath, node);
    }
    parent = dirNodes.get(currentPath);
  }
}

function propagateSizes(node) {
  if (!node.children || node.children.length === 0) return node.size;
  let total = 0;
  for (const child of node.children) {
    total += propagateSizes(child);
  }
  node.size = total;
  return total;
}

module.exports = { analyze, buildComparison, findDuplicates, buildSpaceAnalysis };
