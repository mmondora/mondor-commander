import { describe, it, expect } from 'vitest';
import { humanSize } from '../src/scanner/walker.js';

describe('humanSize', () => {
  it('formats zero bytes', () => {
    expect(humanSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(humanSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(humanSize(1024)).toBe('1.0 KB');
  });

  it('formats megabytes', () => {
    expect(humanSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(humanSize(1024 ** 3)).toBe('1.0 GB');
  });

  it('formats fractional values', () => {
    expect(humanSize(1536)).toBe('1.5 KB');
  });

  it('formats large megabyte values', () => {
    expect(humanSize(500 * 1024 * 1024)).toBe('500.0 MB');
  });
});

// shouldExclude is not exported, so we test it via a local copy
function shouldExclude(name, excludePatterns) {
  return excludePatterns.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(name);
    }
    return name === pattern;
  });
}

describe('shouldExclude', () => {
  it('matches exact names', () => {
    expect(shouldExclude('node_modules', ['node_modules', '.git'])).toBe(true);
  });

  it('rejects non-matching names', () => {
    expect(shouldExclude('src', ['node_modules', '.git'])).toBe(false);
  });

  it('matches wildcard patterns', () => {
    expect(shouldExclude('file.log', ['*.log'])).toBe(true);
  });

  it('rejects non-matching wildcards', () => {
    expect(shouldExclude('file.txt', ['*.log'])).toBe(false);
  });

  it('matches .DS_Store exactly', () => {
    expect(shouldExclude('.DS_Store', ['.DS_Store'])).toBe(true);
  });

  it('matches complex glob patterns', () => {
    expect(shouldExclude('test.spec.js', ['*.spec.*'])).toBe(true);
  });
});
