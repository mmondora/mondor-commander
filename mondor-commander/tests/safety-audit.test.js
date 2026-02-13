import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import { globSync } from 'glob';

const FORBIDDEN_WRITE_OPS = [
  'fs.writeFile', 'fs.writeFileSync',
  'fs.copyFile', 'fs.copyFileSync',
  'fs.unlink', 'fs.unlinkSync',
  'fs.rename', 'fs.renameSync',
  'fs.mkdir', 'fs.mkdirSync',
  'fs.rmdir', 'fs.rmdirSync',
  'fs.rm', 'fs.rmSync',
  'fs.appendFile', 'fs.appendFileSync',
  'fs.createWriteStream'
];

const WRITE_FLAGS = ["'w'", "'a'", "'r+'", "'w+'", "'a+'"];

// Files allowed to use write operations (relative to src/)
const WHITELIST = [
  'server/mcp-manager.js'
];

const srcDir = resolve(import.meta.dirname, '..', 'src');

describe('Safety Audit — no unauthorized filesystem writes', () => {
  const jsFiles = globSync('**/*.js', { cwd: srcDir });

  for (const file of jsFiles) {
    const relPath = file;
    if (WHITELIST.includes(relPath)) continue;

    it(`${relPath} contains no forbidden write operations`, () => {
      const content = readFileSync(resolve(srcDir, file), 'utf-8');
      const violations = [];

      for (const op of FORBIDDEN_WRITE_OPS) {
        if (content.includes(op)) {
          violations.push(op);
        }
      }

      for (const flag of WRITE_FLAGS) {
        // Look for open/openSync with write flags
        const flagPattern = new RegExp(`fs\\.open(?:Sync)?\\([^)]*${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        if (flagPattern.test(content)) {
          violations.push(`fs.open* with flag ${flag}`);
        }
      }

      expect(violations, `${relPath} uses forbidden write ops: ${violations.join(', ')}`).toEqual([]);
    });
  }
});
