'use strict';

const path = require('path');

/**
 * Generate a sync script from a tagged sync plan.
 * @param {object} plan - SyncPlan with entries Map
 * @param {object} opts - { format: 'bash'|'powershell', dryRun: true }
 * @returns {{ script: string, filename: string, stats: object, warnings: string[] }}
 */
function generateScript(plan, opts = {}) {
  const format = opts.format || 'bash';
  const dryRun = opts.dryRun !== false;

  const warnings = [];
  const stats = { copy: 0, overwrite: 0, delete: 0, keepRight: 0, keep: 0, skip: 0, untagged: 0 };

  const commands = [];
  const dirsToCreate = new Set();

  // Collect tagged entries
  const taggedEntries = [];
  for (const entry of plan.entries.values()) {
    if (!entry.action) {
      stats.untagged++;
      continue;
    }
    stats[entry.action === 'keep-right' ? 'keepRight' : entry.action]++;
    taggedEntries.push(entry);
  }

  if (stats.untagged > 0) {
    warnings.push(`${stats.untagged} files have no tag and will be skipped`);
  }

  // Sort entries for predictable output
  taggedEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const entry of taggedEntries) {
    const relPath = entry.relativePath;
    const leftPath = path.join(plan.leftRoot, relPath);
    const rightPath = path.join(plan.rightRoot, relPath);
    const parentDir = path.dirname(relPath);

    switch (entry.action) {
      case 'copy':
        // Copy from left to right
        if (parentDir !== '.') dirsToCreate.add(path.join(plan.rightRoot, parentDir));
        commands.push({ type: 'copy', src: leftPath, dst: rightPath, comment: `COPY ${relPath}` });
        break;

      case 'overwrite':
        // Overwrite right with left (backup first)
        if (parentDir !== '.') dirsToCreate.add(path.join(plan.rightRoot, parentDir));
        commands.push({ type: 'backup', src: rightPath, comment: `BACKUP ${relPath}` });
        commands.push({ type: 'copy', src: leftPath, dst: rightPath, comment: `OVERWRITE ${relPath}` });
        break;

      case 'keep-right':
        // Copy from right to left
        if (parentDir !== '.') dirsToCreate.add(path.join(plan.leftRoot, parentDir));
        commands.push({ type: 'copy', src: rightPath, dst: leftPath, comment: `KEEP-RIGHT ${relPath} (copy right→left)` });
        break;

      case 'delete':
        // Move to staging dir instead of rm
        commands.push({ type: 'delete', src: rightPath, comment: `DELETE ${relPath}` });
        break;

      case 'keep':
      case 'skip':
        // No action needed
        break;
    }
  }

  let script;
  let filename;

  if (format === 'powershell') {
    script = generatePowerShell(commands, dirsToCreate, plan, dryRun, stats);
    filename = `sync-${Date.now()}.ps1`;
  } else {
    script = generateBash(commands, dirsToCreate, plan, dryRun, stats);
    filename = `sync-${Date.now()}.sh`;
  }

  return { script, filename, stats, warnings };
}

function generateBash(commands, dirsToCreate, plan, dryRun, stats) {
  const lines = [];

  lines.push('#!/usr/bin/env bash');
  lines.push('set -euo pipefail');
  lines.push('');
  lines.push('# ═══════════════════════════════════════════════════');
  lines.push('# Mondor Commander — Sync Script');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Left:  ${plan.leftRoot}`);
  lines.push(`# Right: ${plan.rightRoot}`);
  lines.push(`# Mode:  ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  lines.push(`# Stats: copy=${stats.copy} overwrite=${stats.overwrite} delete=${stats.delete} keep-right=${stats.keepRight}`);
  lines.push('# ═══════════════════════════════════════════════════');
  lines.push('');

  if (dryRun) {
    lines.push('echo "=== DRY RUN — no changes will be made ==="');
    lines.push('');
  }

  // Staging dir for deletes
  const hasDeletes = commands.some(c => c.type === 'delete');
  if (hasDeletes) {
    const stagingDir = `${plan.rightRoot}/.mondor-deleted-${Date.now()}`;
    if (dryRun) {
      lines.push(`echo "Would create staging dir: ${escapeBash(stagingDir)}"`);
    } else {
      lines.push(`STAGING_DIR="${escapeBash(stagingDir)}"`);
      lines.push('mkdir -p "$STAGING_DIR"');
    }
    lines.push('');
  }

  // Create directories
  if (dirsToCreate.size > 0) {
    lines.push('# ── Create directories ──');
    for (const dir of [...dirsToCreate].sort()) {
      if (dryRun) {
        lines.push(`echo "mkdir -p ${escapeBash(dir)}"`);
      } else {
        lines.push(`mkdir -p "${escapeBash(dir)}"`);
      }
    }
    lines.push('');
  }

  // Execute commands
  for (const cmd of commands) {
    lines.push(`# ${cmd.comment}`);
    switch (cmd.type) {
      case 'copy':
        if (dryRun) {
          lines.push(`echo "cp ${escapeBash(cmd.src)} → ${escapeBash(cmd.dst)}"`);
        } else {
          lines.push(`cp "${escapeBash(cmd.src)}" "${escapeBash(cmd.dst)}"`);
        }
        break;
      case 'backup':
        if (dryRun) {
          lines.push(`echo "backup ${escapeBash(cmd.src)} → ${escapeBash(cmd.src)}.bak"`);
        } else {
          lines.push(`cp "${escapeBash(cmd.src)}" "${escapeBash(cmd.src)}.bak"`);
        }
        break;
      case 'delete':
        if (dryRun) {
          lines.push(`echo "mv ${escapeBash(cmd.src)} → staging"`);
        } else {
          lines.push(`mv "${escapeBash(cmd.src)}" "$STAGING_DIR/"`);
        }
        break;
    }
    lines.push('');
  }

  lines.push('echo "Sync complete!"');
  return lines.join('\n');
}

function generatePowerShell(commands, dirsToCreate, plan, dryRun, stats) {
  const lines = [];

  lines.push('# ═══════════════════════════════════════════════════');
  lines.push('# Mondor Commander — Sync Script (PowerShell)');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Left:  ${plan.leftRoot}`);
  lines.push(`# Right: ${plan.rightRoot}`);
  lines.push(`# Mode:  ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  lines.push(`# Stats: copy=${stats.copy} overwrite=${stats.overwrite} delete=${stats.delete} keep-right=${stats.keepRight}`);
  lines.push('# ═══════════════════════════════════════════════════');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');

  if (dryRun) {
    lines.push('Write-Host "=== DRY RUN — no changes will be made ===" -ForegroundColor Yellow');
    lines.push('');
  }

  const hasDeletes = commands.some(c => c.type === 'delete');
  if (hasDeletes) {
    const stagingDir = `${plan.rightRoot}\\.mondor-deleted-${Date.now()}`;
    if (dryRun) {
      lines.push(`Write-Host "Would create staging dir: ${escapePS(stagingDir)}"`);
    } else {
      lines.push(`$StagingDir = "${escapePS(stagingDir)}"`);
      lines.push('New-Item -ItemType Directory -Force -Path $StagingDir | Out-Null');
    }
    lines.push('');
  }

  // Create directories
  if (dirsToCreate.size > 0) {
    lines.push('# ── Create directories ──');
    for (const dir of [...dirsToCreate].sort()) {
      if (dryRun) {
        lines.push(`Write-Host "New-Item -ItemType Directory -Force -Path '${escapePS(dir)}'"`);
      } else {
        lines.push(`New-Item -ItemType Directory -Force -Path "${escapePS(dir)}" | Out-Null`);
      }
    }
    lines.push('');
  }

  for (const cmd of commands) {
    lines.push(`# ${cmd.comment}`);
    switch (cmd.type) {
      case 'copy':
        if (dryRun) {
          lines.push(`Write-Host "Copy-Item '${escapePS(cmd.src)}' → '${escapePS(cmd.dst)}'"`);
        } else {
          lines.push(`Copy-Item -Path "${escapePS(cmd.src)}" -Destination "${escapePS(cmd.dst)}" -Force`);
        }
        break;
      case 'backup':
        if (dryRun) {
          lines.push(`Write-Host "Backup '${escapePS(cmd.src)}' → '${escapePS(cmd.src)}.bak'"`);
        } else {
          lines.push(`Copy-Item -Path "${escapePS(cmd.src)}" -Destination "${escapePS(cmd.src)}.bak" -Force`);
        }
        break;
      case 'delete':
        if (dryRun) {
          lines.push(`Write-Host "Move-Item '${escapePS(cmd.src)}' → staging"`);
        } else {
          lines.push(`Move-Item -Path "${escapePS(cmd.src)}" -Destination $StagingDir -Force`);
        }
        break;
    }
    lines.push('');
  }

  lines.push('Write-Host "Sync complete!" -ForegroundColor Green');
  return lines.join('\n');
}

function escapeBash(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

function escapePS(str) {
  return str.replace(/"/g, '`"').replace(/\$/g, '`$');
}

module.exports = { generateScript };
