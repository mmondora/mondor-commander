'use strict';

/**
 * Compute diff hunks between two arrays of lines using LCS.
 * Returns { hunks, summary: { additions, deletions, unchanged } }
 */
function computeHunks(linesA, linesB, contextLines = 3) {
  const edits = computeEdits(linesA, linesB);

  // Build raw diff lines
  const diffLines = [];
  let idxA = 0, idxB = 0;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      diffLines.push({ type: 'equal', textA: linesA[idxA], textB: linesB[idxB], lineA: idxA + 1, lineB: idxB + 1 });
      idxA++; idxB++;
    } else if (edit.type === 'delete') {
      diffLines.push({ type: 'delete', textA: linesA[idxA], textB: null, lineA: idxA + 1, lineB: null });
      idxA++;
    } else if (edit.type === 'insert') {
      diffLines.push({ type: 'insert', textA: null, textB: linesB[idxB], lineA: null, lineB: idxB + 1 });
      idxB++;
    }
  }

  // Group into hunks with context
  const hunks = [];
  let additions = 0, deletions = 0, unchanged = 0;
  let i = 0;

  while (i < diffLines.length) {
    // Skip unchanged lines until we find a change
    if (diffLines[i].type === 'equal') {
      unchanged++;
      i++;
      continue;
    }

    // Found a change - collect context before
    const contextStart = Math.max(0, i - contextLines);
    // Re-count: those context lines were previously counted as unchanged, that's fine for summary

    const hunkLines = [];
    let leftStart = null, rightStart = null;

    // Add context before
    for (let c = contextStart; c < i; c++) {
      const dl = diffLines[c];
      if (leftStart === null) leftStart = dl.lineA;
      if (rightStart === null) rightStart = dl.lineB;
      hunkLines.push({ type: 'context', text: dl.textA, lineA: dl.lineA, lineB: dl.lineB });
    }

    // Add changes and merge close hunks
    while (i < diffLines.length) {
      const dl = diffLines[i];

      if (dl.type !== 'equal') {
        if (leftStart === null) leftStart = dl.lineA || (hunkLines.length > 0 ? hunkLines[hunkLines.length - 1].lineA : 1);
        if (rightStart === null) rightStart = dl.lineB || (hunkLines.length > 0 ? hunkLines[hunkLines.length - 1].lineB : 1);

        if (dl.type === 'delete') {
          deletions++;
          hunkLines.push({ type: 'removed', text: dl.textA, lineA: dl.lineA, lineB: null });
        } else {
          additions++;
          hunkLines.push({ type: 'added', text: dl.textB, lineA: null, lineB: dl.lineB });
        }
        i++;
      } else {
        // Check if next change is within 2*contextLines
        let nextChangeIdx = i;
        while (nextChangeIdx < diffLines.length && diffLines[nextChangeIdx].type === 'equal') {
          nextChangeIdx++;
        }

        if (nextChangeIdx < diffLines.length && nextChangeIdx - i <= contextLines * 2) {
          // Merge: add these equal lines as context
          while (i < nextChangeIdx) {
            unchanged++;
            hunkLines.push({ type: 'context', text: diffLines[i].textA, lineA: diffLines[i].lineA, lineB: diffLines[i].lineB });
            i++;
          }
        } else {
          // End hunk: add trailing context
          const contextEnd = Math.min(diffLines.length, i + contextLines);
          for (let c = i; c < contextEnd; c++) {
            unchanged++;
            hunkLines.push({ type: 'context', text: diffLines[c].textA, lineA: diffLines[c].lineA, lineB: diffLines[c].lineB });
          }
          i = contextEnd;
          break;
        }
      }
    }

    if (hunkLines.length > 0) {
      const leftCount = hunkLines.filter(l => l.type !== 'added').length;
      const rightCount = hunkLines.filter(l => l.type !== 'removed').length;
      hunks.push({
        leftStart: leftStart || 1,
        leftCount,
        rightStart: rightStart || 1,
        rightCount,
        lines: hunkLines,
      });
    }
  }

  // Count remaining unchanged
  // (already counted in the loop above)

  return {
    hunks,
    summary: { additions, deletions, unchanged: linesA.length + linesB.length - additions - deletions - (additions + deletions) },
  };
}

/**
 * Compute edit sequence using Myers-like LCS algorithm.
 * For large files (>5000 lines each), falls back to a simpler approach.
 */
function computeEdits(linesA, linesB) {
  const m = linesA.length;
  const n = linesB.length;

  if (m + n > 10000) {
    return computeEditsFallback(linesA, linesB);
  }

  // Standard LCS with DP
  const dp = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    dp[i] = new Uint16Array(n + 1);
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const edits = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      edits.push({ type: 'equal' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ type: 'insert' });
      j--;
    } else {
      edits.push({ type: 'delete' });
      i--;
    }
  }

  edits.reverse();
  return edits;
}

/**
 * Fallback for large files: line-by-line comparison with some basic matching.
 */
function computeEditsFallback(linesA, linesB) {
  const edits = [];
  const maxLen = Math.max(linesA.length, linesB.length);

  // Build a hash map of linesB for quick lookup
  const bIndex = new Map();
  for (let j = 0; j < linesB.length; j++) {
    if (!bIndex.has(linesB[j])) bIndex.set(linesB[j], []);
    bIndex.get(linesB[j]).push(j);
  }

  let i = 0, j = 0;
  while (i < linesA.length && j < linesB.length) {
    if (linesA[i] === linesB[j]) {
      edits.push({ type: 'equal' });
      i++; j++;
    } else {
      // Look ahead in B for a match to linesA[i]
      const bMatches = bIndex.get(linesA[i]);
      const nextBMatch = bMatches ? bMatches.find(idx => idx >= j) : -1;

      // Look ahead in A for a match to linesB[j]
      let nextAMatch = -1;
      for (let k = i + 1; k < Math.min(i + 10, linesA.length); k++) {
        if (linesA[k] === linesB[j]) { nextAMatch = k; break; }
      }

      if (nextBMatch !== undefined && nextBMatch >= 0 && nextBMatch - j <= 5 && (nextAMatch < 0 || nextBMatch - j <= nextAMatch - i)) {
        // Insert lines from B until we match
        while (j < nextBMatch) {
          edits.push({ type: 'insert' });
          j++;
        }
      } else if (nextAMatch >= 0 && nextAMatch - i <= 5) {
        // Delete lines from A until we match
        while (i < nextAMatch) {
          edits.push({ type: 'delete' });
          i++;
        }
      } else {
        // No close match; delete from A, insert from B
        edits.push({ type: 'delete' });
        i++;
      }
    }
  }

  while (i < linesA.length) { edits.push({ type: 'delete' }); i++; }
  while (j < linesB.length) { edits.push({ type: 'insert' }); j++; }

  return edits;
}

module.exports = { computeHunks };
