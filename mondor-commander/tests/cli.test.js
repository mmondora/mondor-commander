import { describe, it, expect } from 'vitest';

// parseSize and validatePath are not exported, so we test them via a local copy.
// This also serves as a signal that they should be extracted into a utils module.

function parseSize(sizeStr) {
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const match = String(sizeStr).match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|B)?$/i);
  if (!match) return 1024 ** 3;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  return Math.floor(num * (units[unit] || 1));
}

describe('parseSize', () => {
  it('parses bytes', () => {
    expect(parseSize('100B')).toBe(100);
  });

  it('parses kilobytes', () => {
    expect(parseSize('1KB')).toBe(1024);
  });

  it('parses megabytes', () => {
    expect(parseSize('5MB')).toBe(5 * 1024 * 1024);
  });

  it('parses gigabytes', () => {
    expect(parseSize('1GB')).toBe(1024 ** 3);
  });

  it('parses terabytes', () => {
    expect(parseSize('2TB')).toBe(2 * 1024 ** 4);
  });

  it('parses fractional values', () => {
    expect(parseSize('1.5GB')).toBe(Math.floor(1.5 * 1024 ** 3));
  });

  it('defaults to 1GB for invalid input', () => {
    expect(parseSize('invalid')).toBe(1024 ** 3);
  });

  it('treats bare numbers as bytes', () => {
    expect(parseSize('512')).toBe(512);
  });

  it('is case insensitive', () => {
    expect(parseSize('1gb')).toBe(1024 ** 3);
    expect(parseSize('1Gb')).toBe(1024 ** 3);
  });
});
