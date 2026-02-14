const fs = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');
const { PHOTO_EXTENSIONS } = require('./photos/detector.js');

function humanSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function permissionsString(mode) {
  const octal = (mode & 0o777).toString(8);
  const map = { '0': '---', '1': '--x', '2': '-w-', '3': '-wx', '4': 'r--', '5': 'r-x', '6': 'rw-', '7': 'rwx' };
  return octal.split('').map(d => map[d]).join('');
}

function shouldExclude(name, excludePatterns) {
  return excludePatterns.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(name);
    }
    return name === pattern;
  });
}

class Walker extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.visitedInodes = new Set();
  }

  async walk(rootPath, side) {
    const startTime = Date.now();
    const files = [];
    const dirs = [];
    let scannedCount = 0;
    this.visitedInodes.clear();

    const walkDir = async (dirPath, depth) => {
      if (depth > this.config.maxDepth) return;

      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch (err) {
        if (this.config.verbose) {
          console.error(`  Skipping ${dirPath}: ${err.message}`);
        }
        return;
      }

      for (const entry of entries) {
        if (shouldExclude(entry.name, this.config.exclude)) continue;

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        let stat;
        try {
          stat = this.config.followSymlinks
            ? await fs.stat(fullPath)
            : await fs.lstat(fullPath);
        } catch (err) {
          if (this.config.verbose) {
            console.error(`  Cannot stat ${fullPath}: ${err.message}`);
          }
          continue;
        }

        const isSymlink = entry.isSymbolicLink ? entry.isSymbolicLink() : false;
        const isDir = stat.isDirectory();

        // Symlink loop detection: check inode for directories when following symlinks
        if (isDir && this.config.followSymlinks) {
          const inodeKey = stat.ino + ':' + stat.dev;
          if (this.visitedInodes.has(inodeKey)) {
            if (this.config.verbose) {
              console.error(`  Skipping symlink cycle: ${fullPath}`);
            }
            continue;
          }
          this.visitedInodes.add(inodeKey);
        }

        if (isDir) {
          dirs.push(relativePath);
          await walkDir(fullPath, depth + 1);
        } else if (stat.isFile()) {
          const ext = path.extname(entry.name).toLowerCase().replace(/^\./, '');
          files.push({
            path: relativePath,
            absolutePath: fullPath,
            name: entry.name,
            extension: ext,
            size: stat.size,
            sizeHuman: humanSize(stat.size),
            hash: '',
            modified: stat.mtime.toISOString(),
            created: stat.birthtime.toISOString(),
            isDirectory: false,
            isSymlink,
            isPhoto: PHOTO_EXTENSIONS.has(ext),
            permissions: permissionsString(stat.mode),
            depth: depth,
          });

          scannedCount++;
          if (scannedCount % 100 === 0) {
            this.emit('progress', { side, scanned: scannedCount, found: scannedCount });
          }
        }
      }
    };

    await walkDir(rootPath, 0);

    // Emit final progress
    this.emit('progress', { side, scanned: files.length, found: files.length });

    const duration = Date.now() - startTime;

    // Build tree structure
    const tree = buildTree(files, dirs);

    return {
      root: rootPath,
      totalFiles: files.length,
      totalDirs: dirs.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      totalSizeHuman: humanSize(files.reduce((sum, f) => sum + f.size, 0)),
      scanDuration: duration,
      files,
      dirs,
      tree,
    };
  }
}

function buildTree(files, dirs) {
  const root = { name: '.', children: [], isDirectory: true };
  const dirMap = new Map();
  dirMap.set('.', root);

  // Ensure all directory nodes exist
  const allDirPaths = new Set(dirs);
  for (const f of files) {
    const dir = path.dirname(f.path);
    if (dir !== '.') allDirPaths.add(dir);
  }

  const sortedDirs = [...allDirPaths].sort();
  for (const dirPath of sortedDirs) {
    const parts = dirPath.split(path.sep);
    let current = root;
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? currentPath + path.sep + part : part;
      if (!dirMap.has(currentPath)) {
        const node = { name: part, path: currentPath, children: [], isDirectory: true };
        current.children.push(node);
        dirMap.set(currentPath, node);
      }
      current = dirMap.get(currentPath);
    }
  }

  // Add files to their directory nodes
  for (const f of files) {
    const dir = path.dirname(f.path);
    const parentKey = dir === '.' ? '.' : dir;
    const parent = dirMap.get(parentKey);
    if (parent) {
      parent.children.push({ name: f.name, path: f.path, isDirectory: false, file: f });
    }
  }

  // Sort children: directories first, then files, alphabetically
  const sortChildren = (node) => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.filter(c => c.isDirectory).forEach(sortChildren);
    }
  };
  sortChildren(root);

  return root.children;
}

module.exports = { Walker, humanSize };
