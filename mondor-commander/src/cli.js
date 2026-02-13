const { Command } = require('commander');
const path = require('path');
const fs = require('fs/promises');
const { startServer } = require('./server/index.js');
const { version } = require('../package.json');

const program = new Command();

program
  .name('mc')
  .description('Mondor Commander — Norton Commander-style directory analyzer')
  .version(version)
  .argument('<path1>', 'First directory to analyze')
  .argument('[path2]', 'Second directory to compare (optional)')
  .option('-p, --port <number>', 'Server port', '8333')
  .option('--no-open', "Don't auto-open browser")
  .option('--max-depth <number>', 'Max recursion depth')
  .option('--max-file-size <size>', 'Skip hashing files larger than this', '1GB')
  .option('--exclude <patterns...>', 'Glob patterns to exclude', ['node_modules', '.git', '.DS_Store'])
  .option('--no-hash', 'Skip SHA-256 hashing (faster, no duplicate detection)')
  .option('--follow-symlinks', 'Follow symbolic links', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .action(async (path1, path2, options) => {
    try {
      const resolvedPath1 = path.resolve(path1);
      await validatePath(resolvedPath1);

      let resolvedPath2 = null;
      if (path2) {
        resolvedPath2 = path.resolve(path2);
        await validatePath(resolvedPath2);
      }

      const port = parseInt(options.port, 10);
      const maxDepth = options.maxDepth ? parseInt(options.maxDepth, 10) : Infinity;
      const maxFileSize = parseSize(options.maxFileSize);

      const config = {
        path1: resolvedPath1,
        path2: resolvedPath2,
        port,
        autoOpen: options.open,
        maxDepth,
        maxFileSize,
        exclude: options.exclude,
        hash: options.hash,
        followSymlinks: options.followSymlinks,
        verbose: options.verbose,
        dualMode: !!resolvedPath2,
      };

      if (config.verbose) {
        console.log('Configuration:', JSON.stringify(config, null, 2));
      }

      await startServer(config);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

async function validatePath(p) {
  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${p}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Path does not exist: ${p}`);
    }
    throw err;
  }
}

function parseSize(sizeStr) {
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const match = String(sizeStr).match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|B)?$/i);
  if (!match) return 1024 ** 3; // default 1GB
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  return Math.floor(num * (units[unit] || 1));
}

program.parse();
