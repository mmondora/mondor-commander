const { Router } = require('express');
const fs = require('fs/promises');
const path = require('path');

function createApiRouter(store) {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json({
      status: store.status, // 'scanning' | 'analyzing' | 'ready'
      dualMode: store.config.dualMode,
      path1: store.config.path1,
      path2: store.config.path2,
      progress: store.progress,
    });
  });

  router.get('/scan/left', (req, res) => {
    if (store.status === 'scanning') return res.status(202).json({ status: 'scanning' });
    if (!store.scanLeft) return res.status(404).json({ error: 'No scan data' });
    // Return without the full files array for lightweight listing
    const { files, dirs, ...summary } = store.scanLeft;
    res.json({ ...summary, fileCount: files.length });
  });

  router.get('/scan/right', (req, res) => {
    if (!store.config.dualMode) return res.status(404).json({ error: 'Single directory mode' });
    if (store.status === 'scanning') return res.status(202).json({ status: 'scanning' });
    if (!store.scanRight) return res.status(404).json({ error: 'No scan data' });
    const { files, dirs, ...summary } = store.scanRight;
    res.json({ ...summary, fileCount: files.length });
  });

  router.get('/compare', (req, res) => {
    if (!store.config.dualMode) return res.status(404).json({ error: 'Single directory mode' });
    if (store.status !== 'ready') return res.status(202).json({ status: store.status });
    if (!store.analysis || !store.analysis.comparison) return res.status(404).json({ error: 'No comparison data' });
    const c = store.analysis.comparison;
    res.json({
      onlyLeft: c.onlyLeft,
      onlyRight: c.onlyRight,
      common: c.common,
      modified: c.modified,
      stats: {
        onlyLeftCount: c.onlyLeft.length,
        onlyRightCount: c.onlyRight.length,
        commonCount: c.common.length,
        modifiedCount: c.modified.length,
        onlyLeftSize: c.onlyLeft.reduce((s, f) => s + f.size, 0),
        onlyRightSize: c.onlyRight.reduce((s, f) => s + f.size, 0),
      }
    });
  });

  router.get('/space/left', (req, res) => {
    if (store.status !== 'ready') return res.status(202).json({ status: store.status });
    if (!store.analysis || !store.analysis.spaceLeft) return res.status(404).json({ error: 'No space data' });
    res.json(store.analysis.spaceLeft);
  });

  router.get('/space/right', (req, res) => {
    if (!store.config.dualMode) return res.status(404).json({ error: 'Single directory mode' });
    if (store.status !== 'ready') return res.status(202).json({ status: store.status });
    if (!store.analysis || !store.analysis.spaceRight) return res.status(404).json({ error: 'No space data' });
    res.json(store.analysis.spaceRight);
  });

  router.get('/duplicates', (req, res) => {
    if (store.status !== 'ready') return res.status(202).json({ status: store.status });
    if (!store.analysis) return res.status(404).json({ error: 'No analysis data' });
    const dupes = store.analysis.duplicatesAll || [];
    const totalWasted = dupes.reduce((sum, g) => sum + g.wastedSpace, 0);
    res.json({
      groups: dupes,
      totalGroups: dupes.length,
      totalWastedSpace: totalWasted,
      totalWastedHuman: humanSize(totalWasted),
    });
  });

  router.get('/browse', (req, res) => {
    const side = req.query.side || 'left';
    const browsePath = req.query.path || '';

    const scan = side === 'right' ? store.scanRight : store.scanLeft;
    if (!scan) return res.status(404).json({ error: 'No scan data' });

    // Get the comparison data for color coding (pre-build index for O(1) lookups)
    const comparison = store.analysis ? store.analysis.comparison : null;
    const comparisonIndex = buildComparisonIndex(comparison);

    // Filter files and dirs at this path level
    const normalizedPath = browsePath.replace(/^\/+|\/+$/g, '');
    const prefix = normalizedPath ? normalizedPath + path.sep : '';

    const entries = [];
    const seenDirs = new Set();

    for (const f of scan.files) {
      if (normalizedPath && !f.path.startsWith(prefix)) continue;
      if (!normalizedPath && f.path.includes(path.sep)) {
        // Only show immediate children at root
        const topDir = f.path.split(path.sep)[0];
        if (!seenDirs.has(topDir)) {
          seenDirs.add(topDir);
          // Calculate directory size
          const dirSize = scan.files
            .filter(ff => ff.path.startsWith(topDir + path.sep) || ff.path === topDir)
            .reduce((sum, ff) => sum + ff.size, 0);
          entries.push({
            name: topDir,
            path: topDir,
            isDirectory: true,
            size: dirSize,
            sizeHuman: humanSize(dirSize),
            status: getDirStatus(topDir, comparisonIndex, side),
          });
        }
        continue;
      }

      if (normalizedPath) {
        const rest = f.path.slice(prefix.length);
        if (rest.includes(path.sep)) {
          const topDir = rest.split(path.sep)[0];
          const fullDirPath = prefix + topDir;
          if (!seenDirs.has(fullDirPath)) {
            seenDirs.add(fullDirPath);
            const dirSize = scan.files
              .filter(ff => ff.path.startsWith(fullDirPath + path.sep) || ff.path === fullDirPath)
              .reduce((sum, ff) => sum + ff.size, 0);
            entries.push({
              name: topDir,
              path: fullDirPath,
              isDirectory: true,
              size: dirSize,
              sizeHuman: humanSize(dirSize),
              status: getDirStatus(fullDirPath, comparisonIndex, side),
            });
          }
          continue;
        }
      }

      // It's a direct file at this level
      entries.push({
        name: f.name,
        path: f.path,
        isDirectory: false,
        size: f.size,
        sizeHuman: f.sizeHuman,
        modified: f.modified,
        extension: f.extension,
        hash: f.hash,
        status: getFileStatus(f.path, comparisonIndex, side),
      });
    }

    // Sort: dirs first, then files alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      path: normalizedPath,
      entries,
      parentPath: normalizedPath ? path.dirname(normalizedPath) : null,
    });
  });

  router.get('/file-content', async (req, res) => {
    try {
      const side = req.query.side || 'left';
      const filePath = req.query.path || '';
      const scan = side === 'right' ? store.scanRight : store.scanLeft;
      if (!scan) return res.status(404).json({ error: 'No scan data' });

      const file = scan.files.find(f => f.path === filePath);
      if (!file) return res.status(404).json({ error: 'File not found' });

      // Path traversal protection: ensure file is within scan root
      const resolvedFile = path.resolve(file.absolutePath);
      const resolvedRoot = path.resolve(scan.root);
      if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Only serve text files, max 1MB
      if (file.size > 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 1MB)', size: file.size, meta: sanitizeFile(file) });
      }

      const textExts = new Set(['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'xml', 'html', 'htm',
        'css', 'scss', 'less', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'sh',
        'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'sql', 'graphql',
        'svelte', 'vue', 'php', 'pl', 'r', 'swift', 'kt', 'scala', 'lua', 'vim', 'el',
        'ex', 'exs', 'erl', 'hs', 'ml', 'clj', 'cljs', 'dart', 'tf', 'dockerfile',
        'makefile', 'cmake', 'gradle', 'properties', 'csv', 'tsv', 'log', 'diff', 'patch',
        'gitignore', 'editorconfig', 'prettierrc', 'eslintrc', 'babelrc', 'lock']);

      const isText = textExts.has(file.extension) ||
        file.extension === '' ||
        file.name.startsWith('.');

      if (!isText) {
        return res.status(415).json({ binary: true, meta: sanitizeFile(file) });
      }

      const content = await fs.readFile(file.absolutePath, 'utf-8');
      res.json({ content, meta: sanitizeFile(file) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function buildComparisonIndex(comparison) {
  if (!comparison) return null;
  return {
    common: new Set(comparison.common.map(f => f.path)),
    modified: new Set(comparison.modified.map(m => m.relativePath)),
    onlyLeft: new Set(comparison.onlyLeft.map(f => f.path)),
    onlyRight: new Set(comparison.onlyRight.map(f => f.path)),
  };
}

function getFileStatus(filePath, index, side) {
  if (!index) return 'normal';
  if (index.common.has(filePath)) return 'identical';
  if (index.modified.has(filePath)) return 'modified';
  if (side === 'left' && index.onlyLeft.has(filePath)) return 'only-here';
  if (side === 'right' && index.onlyRight.has(filePath)) return 'only-here';
  return 'normal';
}

function getDirStatus(dirPath, index, side) {
  if (!index) return 'directory';
  return 'directory';
}

function sanitizeFile(file) {
  const { absolutePath, ...safe } = file;
  return safe;
}

function humanSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

module.exports = { createApiRouter };
