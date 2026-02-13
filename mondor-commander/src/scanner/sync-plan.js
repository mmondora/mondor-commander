'use strict';

const VALID_ACTIONS = new Set(['copy', 'overwrite', 'keep-right', 'delete', 'keep', 'skip']);

function suggestedActionFor(status) {
  switch (status) {
    case 'missing': return 'copy';
    case 'modified': return 'overwrite';
    case 'orphan': return 'delete';
    case 'identical': return 'skip';
    default: return null;
  }
}

function buildSyncPlan(comparison, leftRoot, rightRoot) {
  const entries = new Map();

  for (const f of comparison.onlyLeft) {
    entries.set(f.path, { id: f.path, relativePath: f.path, status: 'missing', suggestedAction: 'copy', action: null, left: f, right: null });
  }

  for (const f of comparison.onlyRight) {
    entries.set(f.path, { id: f.path, relativePath: f.path, status: 'orphan', suggestedAction: 'delete', action: null, left: null, right: f });
  }

  for (const m of comparison.modified) {
    entries.set(m.relativePath, {
      id: m.relativePath,
      relativePath: m.relativePath,
      status: 'modified',
      suggestedAction: 'overwrite',
      action: null,
      left: m.left,
      right: m.right,
      newerSide: m.newerSide,
      sizeDiff: m.sizeDiff,
    });
  }

  for (const f of comparison.common) {
    entries.set(f.path, { id: f.path, relativePath: f.path, status: 'identical', suggestedAction: 'skip', action: null, left: f, right: f });
  }

  return { leftRoot, rightRoot, entries, createdAt: Date.now() };
}

function tagFile(plan, relativePath, action) {
  if (action !== null && !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${action}`);
  }
  const entry = plan.entries.get(relativePath);
  if (!entry) throw new Error(`File not found in plan: ${relativePath}`);
  entry.action = action;
}

function tagBulk(plan, paths, action) {
  for (const p of paths) {
    tagFile(plan, p, action);
  }
}

function tagByStatus(plan, status, action) {
  for (const entry of plan.entries.values()) {
    if (entry.status === status) {
      entry.action = action;
    }
  }
}

function resetTags(plan) {
  for (const entry of plan.entries.values()) {
    entry.action = null;
  }
}

function getSummary(plan) {
  const byStatus = { missing: 0, orphan: 0, modified: 0, identical: 0 };
  const byAction = { copy: 0, overwrite: 0, 'keep-right': 0, delete: 0, keep: 0, skip: 0, untagged: 0 };
  let estimatedTransfer = 0;

  for (const entry of plan.entries.values()) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    if (entry.action) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      if ((entry.action === 'copy' || entry.action === 'overwrite') && entry.left) {
        estimatedTransfer += entry.left.size || 0;
      }
    } else {
      byAction.untagged++;
    }
  }

  return { total: plan.entries.size, byStatus, byAction, estimatedTransfer };
}

function planToJSON(plan) {
  const entries = [];
  for (const entry of plan.entries.values()) {
    entries.push(entry);
  }
  return {
    leftRoot: plan.leftRoot,
    rightRoot: plan.rightRoot,
    createdAt: plan.createdAt,
    entries,
    summary: getSummary(plan),
  };
}

module.exports = { buildSyncPlan, tagFile, tagBulk, tagByStatus, resetTags, getSummary, planToJSON, VALID_ACTIONS };
