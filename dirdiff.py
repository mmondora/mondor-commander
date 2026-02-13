#!/usr/bin/env python3
"""
DirDiff - Directory comparison tool with web interface.
Compares two directories and shows identical, modified, and unique files
through a browsable local web interface with git-style diffs.

Usage:
    python3 dirdiff.py /path/to/dir1 /path/to/dir2 [--port 8765] [--no-browser]
"""

import argparse
import hashlib
import json
import os
import sys
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import unified_diff
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import html
import mimetypes
import time

# ---------------------------------------------------------------------------
# Scanning & comparison logic
# ---------------------------------------------------------------------------

def md5_file(filepath, chunk_size=65536):
    h = hashlib.md5()
    try:
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except (OSError, PermissionError):
        return None


def scan_directory(root):
    """Walk *root* and return {relative_path: absolute_path}."""
    root = os.path.realpath(root)
    result = {}
    for dirpath, _dirnames, filenames in os.walk(root):
        for fname in filenames:
            abs_path = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(abs_path, root)
            result[rel_path] = abs_path
    return result


def file_info(abs_path):
    try:
        st = os.stat(abs_path)
        return {"size": st.st_size, "mtime": st.st_mtime}
    except OSError:
        return {"size": 0, "mtime": 0}


def is_text_file(filepath):
    """Quick heuristic: read first 8 KB and look for null bytes."""
    try:
        with open(filepath, "rb") as f:
            chunk = f.read(8192)
        return b"\x00" not in chunk
    except (OSError, PermissionError):
        return False


def compare_directories(left_root, right_root, progress_cb=None):
    """Compare two directory trees.

    Returns a dict with keys:
        identical   – list of {path, size, mtime_left, mtime_right}
        modified    – list of {path, size_left, size_right, mtime_left, mtime_right, is_text}
        only_left   – list of {path, size, mtime}
        only_right  – list of {path, size, mtime}
    """
    left_files = scan_directory(left_root)
    right_files = scan_directory(right_root)

    left_set = set(left_files)
    right_set = set(right_files)

    common = sorted(left_set & right_set)
    only_left_paths = sorted(left_set - right_set)
    only_right_paths = sorted(right_set - left_set)

    # Hash common files in parallel
    paths_to_hash = []
    for rel in common:
        paths_to_hash.append(("left", rel, left_files[rel]))
        paths_to_hash.append(("right", rel, right_files[rel]))

    hashes = {}  # (side, rel) -> hash
    total = len(paths_to_hash)
    done = 0

    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
        futures = {}
        for side, rel, absp in paths_to_hash:
            fut = pool.submit(md5_file, absp)
            futures[fut] = (side, rel)
        for fut in as_completed(futures):
            side, rel = futures[fut]
            hashes[(side, rel)] = fut.result()
            done += 1
            if progress_cb and done % 200 == 0:
                progress_cb(done, total)

    identical = []
    modified = []

    for rel in common:
        lh = hashes.get(("left", rel))
        rh = hashes.get(("right", rel))
        li = file_info(left_files[rel])
        ri = file_info(right_files[rel])
        if lh == rh:
            identical.append({
                "path": rel,
                "size": li["size"],
                "mtime_left": li["mtime"],
                "mtime_right": ri["mtime"],
            })
        else:
            modified.append({
                "path": rel,
                "size_left": li["size"],
                "size_right": ri["size"],
                "mtime_left": li["mtime"],
                "mtime_right": ri["mtime"],
                "is_text": is_text_file(left_files[rel]) and is_text_file(right_files[rel]),
            })

    only_left = []
    for rel in only_left_paths:
        info = file_info(left_files[rel])
        only_left.append({"path": rel, "size": info["size"], "mtime": info["mtime"]})

    only_right = []
    for rel in only_right_paths:
        info = file_info(right_files[rel])
        only_right.append({"path": rel, "size": info["size"], "mtime": info["mtime"]})

    # Build disk-usage data for both sides
    def _build_disk_usage(file_map):
        by_ext = {}
        files = []
        for rel, absp in file_map.items():
            info = file_info(absp)
            ext = os.path.splitext(rel)[1].lower() or "(no ext)"
            entry = {"path": rel, "size": info["size"], "ext": ext}
            files.append(entry)
            if ext not in by_ext:
                by_ext[ext] = {"count": 0, "total_size": 0}
            by_ext[ext]["count"] += 1
            by_ext[ext]["total_size"] += info["size"]
        files.sort(key=lambda x: x["size"], reverse=True)
        return {
            "total_size": sum(f["size"] for f in files),
            "file_count": len(files),
            "files": files,
            "by_ext": by_ext,
        }

    disk_left = _build_disk_usage(left_files)
    disk_right = _build_disk_usage(right_files)

    return {
        "identical": identical,
        "modified": modified,
        "only_left": only_left,
        "only_right": only_right,
        "left_root": os.path.realpath(left_root),
        "right_root": os.path.realpath(right_root),
        "disk_usage": {"left": disk_left, "right": disk_right},
    }


def get_unified_diff(left_root, right_root, rel_path, context_lines=3):
    """Return unified diff lines for a text file."""
    left_path = os.path.join(left_root, rel_path)
    right_path = os.path.join(right_root, rel_path)
    try:
        with open(left_path, "r", errors="replace") as f:
            left_lines = f.readlines()
        with open(right_path, "r", errors="replace") as f:
            right_lines = f.readlines()
    except OSError:
        return ["Error reading files"]

    diff = unified_diff(
        left_lines, right_lines,
        fromfile=f"LEFT/{rel_path}",
        tofile=f"RIGHT/{rel_path}",
        n=context_lines,
    )
    return list(diff)


# ---------------------------------------------------------------------------
# HTML / JS / CSS – embedded SPA
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DirDiff</title>
<style>
:root {
  --bg: #0d1117;
  --bg2: #161b22;
  --bg3: #1c2129;
  --border: #30363d;
  --text: #e6edf3;
  --text2: #8b949e;
  --accent: #58a6ff;
  --green: #3fb950;
  --red: #f85149;
  --yellow: #d29922;
  --diff-add-bg: #12261e;
  --diff-add-border: #1a4d2e;
  --diff-del-bg: #2d1215;
  --diff-del-border: #5c2326;
  --diff-hunk-bg: #1a1f35;
}
* { margin:0; padding:0; box-sizing:border-box; }
html, body { height:100%; overflow:hidden; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:var(--bg); color:var(--text); line-height:1.5; display:flex; flex-direction:column; }

/* ---- Header ---- */
.header { background:var(--bg2); border-bottom:1px solid var(--border); padding:10px 16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; flex-shrink:0; }
.header h1 { font-size:18px; font-weight:600; white-space:nowrap; }
.search-box { background:var(--bg3); border:1px solid var(--border); border-radius:6px; padding:6px 10px; color:var(--text); font-size:13px; width:260px; max-width:100%; outline:none; }
.search-box:focus { border-color:var(--accent); }
.header-counters { display:flex; gap:10px; font-size:12px; margin-left:auto; flex-wrap:wrap; }
.header-counter { display:flex; align-items:center; gap:4px; color:var(--text2); }
.header-counter .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
.header-counter .cnt { font-weight:600; }

/* ---- Main panels area ---- */
.panels-wrapper { flex:1; display:grid; grid-template-columns:1fr 4px 1fr; min-height:0; position:relative; }

/* Divider */
.panel-divider { background:var(--border); cursor:col-resize; position:relative; z-index:5; }
.panel-divider:hover, .panel-divider.dragging { background:var(--accent); }

/* Individual panel */
.panel { display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.panel-header { background:var(--bg2); border-bottom:1px solid var(--border); padding:6px 12px; font-size:12px; color:var(--text2); font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; display:flex; align-items:center; gap:6px; }
.panel-header .side-label { font-weight:700; text-transform:uppercase; letter-spacing:.5px; font-size:11px; padding:1px 6px; border-radius:3px; }
.panel-header .side-label.left { background:var(--red); color:#fff; opacity:.8; }
.panel-header .side-label.right { background:var(--accent); color:#fff; opacity:.8; }
.panel-body { flex:1; overflow-y:auto; overflow-x:hidden; font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace; font-size:13px; }

/* ---- File rows ---- */
.file-row { display:grid; grid-template-columns:1fr auto auto; align-items:center; padding:2px 12px; border-bottom:1px solid transparent; cursor:default; min-height:26px; }
.file-row:hover { background:var(--bg3); }
.file-row.selected { background:var(--bg3); border-bottom-color:var(--border); }
.file-row.placeholder { opacity:.25; }
.file-row .name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.file-row .name .match-hl { background:var(--yellow); color:#000; border-radius:2px; padding:0 1px; }
.file-row .size { font-size:11px; color:var(--text2); white-space:nowrap; padding-left:8px; }
.file-row .indicator { width:10px; text-align:center; padding-left:6px; font-size:14px; line-height:1; }

/* Directory row */
.dir-row { display:flex; align-items:center; padding:2px 12px; cursor:pointer; min-height:26px; font-weight:600; }
.dir-row:hover { background:var(--bg3); }
.dir-row .chevron { display:inline-block; width:14px; font-size:10px; color:var(--text2); transition:transform .15s; flex-shrink:0; }
.dir-row .chevron.open { transform:rotate(90deg); }
.dir-row .dir-icon { margin-right:4px; }

/* ---- Diff panel (bottom) ---- */
.diff-resizer { height:4px; background:var(--border); cursor:row-resize; flex-shrink:0; display:none; }
.diff-resizer:hover, .diff-resizer.dragging { background:var(--accent); }
.diff-panel { background:var(--bg2); border-top:1px solid var(--border); display:none; flex-direction:column; overflow:hidden; flex-shrink:0; }
.diff-panel.open { display:flex; }
.diff-resizer.open { display:block; }
.diff-header { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:var(--bg3); border-bottom:1px solid var(--border); flex-shrink:0; }
.diff-header h3 { font-size:13px; font-family:"SFMono-Regular",Consolas,monospace; font-weight:500; }
.diff-close { font-size:18px; cursor:pointer; color:var(--text2); background:none; border:none; padding:2px 6px; line-height:1; }
.diff-close:hover { color:var(--text); }
.diff-container { flex:1; overflow:auto; font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace; font-size:12px; line-height:1.6; }
.diff-table { width:100%; border-collapse:collapse; }
.diff-table td { padding:0 12px; white-space:pre-wrap; word-break:break-all; }
.diff-line-num { width:1%; min-width:50px; text-align:right; color:var(--text2); user-select:none; padding-right:8px; border-right:1px solid var(--border); }
.diff-add { background:var(--diff-add-bg); }
.diff-add .diff-line-num { background:var(--diff-add-border); }
.diff-del { background:var(--diff-del-bg); }
.diff-del .diff-line-num { background:var(--diff-del-border); }
.diff-hunk { background:var(--diff-hunk-bg); color:var(--accent); font-style:italic; }
.diff-hunk td { padding:4px 12px; }

/* ---- Status bar ---- */
.status-bar { background:var(--bg2); border-top:1px solid var(--border); padding:4px 16px; font-size:11px; color:var(--text2); display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px 16px; flex-shrink:0; }
.status-bar .counters { display:flex; gap:12px; }
.status-bar .disk { display:flex; gap:16px; }

/* ---- Loading ---- */
.loading { padding:60px; text-align:center; }
.spinner { display:inline-block; width:36px; height:36px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin .6s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.loading p { margin-top:12px; color:var(--text2); font-size:14px; }
.empty { padding:40px; text-align:center; color:var(--text2); }
.hidden { display:none !important; }

/* ---- Responsive ---- */
@media (max-width:768px) {
  .panels-wrapper { grid-template-columns:1fr; grid-template-rows:1fr 4px 1fr; }
  .panel-divider { cursor:row-resize; }
  .header { padding:8px 10px; gap:8px; }
  .search-box { width:100%; }
  .header-counters { margin-left:0; width:100%; justify-content:space-between; }
}
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <h1>DirDiff</h1>
  <input type="text" class="search-box" id="search" placeholder="Filter files..." oninput="applyFilter()">
  <div class="header-counters" id="header-counters"></div>
</div>

<!-- Two-panel area -->
<div class="panels-wrapper" id="panels-wrapper">
  <div class="panel" id="panel-left">
    <div class="panel-header"><span class="side-label left">L</span> <span id="path-left"></span></div>
    <div class="panel-body" id="body-left">
      <div class="loading" id="loading"><div class="spinner"></div><p>Scanning directories...</p></div>
    </div>
  </div>
  <div class="panel-divider" id="panel-divider"></div>
  <div class="panel" id="panel-right">
    <div class="panel-header"><span class="side-label right">R</span> <span id="path-right"></span></div>
    <div class="panel-body" id="body-right"></div>
  </div>
</div>

<!-- Diff panel (bottom, hidden until click on modified file) -->
<div class="diff-resizer" id="diff-resizer"></div>
<div class="diff-panel" id="diff-panel">
  <div class="diff-header">
    <h3 id="diff-title"></h3>
    <button class="diff-close" onclick="closeDiff()">&times;</button>
  </div>
  <div class="diff-container" id="diff-container"></div>
</div>

<!-- Status bar -->
<div class="status-bar" id="status-bar"></div>

<script>
/* =========================================================
   State
   ========================================================= */
let DATA = null;
let unifiedTree = [];       // flat array of tree nodes
let expandedDirs = new Set();
let currentFilter = '';
let activeDiffFile = null;
let diffPanelHeight = 0;    // 0 = closed

/* =========================================================
   Utilities (kept from original)
   ========================================================= */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes/1048576).toFixed(1) + ' MB';
  return (bytes/1073741824).toFixed(2) + ' GB';
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/* =========================================================
   Build unified tree from flat data
   ========================================================= */
function buildUnifiedTree(data) {
  // Map: path -> node
  const nodeMap = {};

  function ensureDir(parts) {
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path = path ? path + '/' + parts[i] : parts[i];
      if (!nodeMap[path]) {
        nodeMap[path] = {
          name: parts[i],
          path: path,
          type: 'dir',
          children: [],
          depth: i,
          status: null,  // dirs get aggregate status
          leftInfo: null,
          rightInfo: null,
        };
        // attach to parent
        if (i > 0) {
          const parentPath = parts.slice(0, i).join('/');
          nodeMap[parentPath].children.push(nodeMap[path]);
        }
      }
    }
    return path;
  }

  function addFile(filePath, status, leftInfo, rightInfo) {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    // Ensure parent dirs exist
    if (parts.length > 1) {
      ensureDir(parts.slice(0, -1));
    }
    const node = {
      name: fileName,
      path: filePath,
      type: 'file',
      children: [],
      depth: parts.length - 1,
      status: status,
      leftInfo: leftInfo,
      rightInfo: rightInfo,
    };
    nodeMap[filePath] = node;
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      nodeMap[parentPath].children.push(node);
    }
  }

  // Add all files with their status
  for (const f of data.identical) {
    addFile(f.path, 'identical',
      { size: f.size, mtime: f.mtime_left },
      { size: f.size, mtime: f.mtime_right });
  }
  for (const f of data.modified) {
    addFile(f.path, 'modified',
      { size: f.size_left, mtime: f.mtime_left, is_text: f.is_text },
      { size: f.size_right, mtime: f.mtime_right, is_text: f.is_text });
  }
  for (const f of data.only_left) {
    addFile(f.path, 'only_left',
      { size: f.size, mtime: f.mtime },
      null);
  }
  for (const f of data.only_right) {
    addFile(f.path, 'only_right',
      null,
      { size: f.size, mtime: f.mtime });
  }

  // Collect root-level nodes
  const roots = [];
  for (const key of Object.keys(nodeMap)) {
    if (!key.includes('/')) {
      roots.push(nodeMap[key]);
    }
  }

  // Sort children: dirs first, then files, alphabetical
  function sortChildren(node) {
    if (node.children.length === 0) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortChildren(c);
  }

  roots.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const r of roots) sortChildren(r);

  return roots;
}

/* =========================================================
   Auto-expand: expand dirs containing modified/unique files
   ========================================================= */
function autoExpandTree(roots) {
  expandedDirs.clear();
  let hasInteresting = false;

  function walk(node) {
    if (node.type === 'file') {
      if (node.status !== 'identical') { hasInteresting = true; return true; }
      return false;
    }
    let dominated = false;
    for (const c of node.children) {
      if (walk(c)) dominated = true;
    }
    if (dominated) expandedDirs.add(node.path);
    return dominated;
  }

  for (const r of roots) walk(r);
  // If nothing interesting, expand first level
  if (!hasInteresting) {
    for (const r of roots) {
      if (r.type === 'dir') expandedDirs.add(r.path);
    }
  }
}

/* =========================================================
   Build visible rows (DFS with filter)
   ========================================================= */
function buildVisibleRows(roots, filter) {
  const rows = [];
  const lowerFilter = filter.toLowerCase();

  // If there's a filter, precompute which paths match
  let matchingPaths = null;
  if (lowerFilter) {
    matchingPaths = new Set();
    function collectMatching(node) {
      if (node.type === 'file' && node.path.toLowerCase().includes(lowerFilter)) {
        matchingPaths.add(node.path);
        // Mark all ancestors as needed
        const parts = node.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          matchingPaths.add(parts.slice(0, i).join('/'));
        }
      }
      for (const c of node.children) collectMatching(c);
    }
    for (const r of roots) collectMatching(r);
  }

  function dfs(node) {
    // If filtering, skip nodes not in matchingPaths
    if (matchingPaths && !matchingPaths.has(node.path)) return;

    rows.push(node);

    if (node.type === 'dir') {
      const isExpanded = lowerFilter ? matchingPaths.has(node.path) : expandedDirs.has(node.path);
      if (isExpanded) {
        for (const c of node.children) dfs(c);
      }
    }
  }

  for (const r of roots) dfs(r);
  return rows;
}

/* =========================================================
   Rendering
   ========================================================= */
function renderPanels() {
  const rows = buildVisibleRows(unifiedTree, currentFilter);
  const leftBody = document.getElementById('body-left');
  const rightBody = document.getElementById('body-right');

  let leftHtml = '';
  let rightHtml = '';

  for (const node of rows) {
    const indent = node.depth * 16;
    if (node.type === 'dir') {
      const isExpanded = currentFilter ? true : expandedDirs.has(node.path);
      const chevronCls = isExpanded ? 'chevron open' : 'chevron';
      const dirHtml = '<div class="dir-row" style="padding-left:' + (12 + indent) + 'px" onclick="toggleDir(\'' + escapeAttr(node.path) + '\')">'
        + '<span class="' + chevronCls + '">&#9654;</span>'
        + '<span class="dir-icon">&#128193;</span> ' + highlightMatch(escapeHtml(node.name))
        + '</div>';
      leftHtml += dirHtml;
      rightHtml += dirHtml;
    } else {
      leftHtml += renderFileRow(node, 'left', indent);
      rightHtml += renderFileRow(node, 'right', indent);
    }
  }

  if (rows.length === 0) {
    const emptyMsg = '<div class="empty">No files match the filter.</div>';
    leftHtml = emptyMsg;
    rightHtml = emptyMsg;
  }

  leftBody.innerHTML = leftHtml;
  rightBody.innerHTML = rightHtml;
}

function renderFileRow(node, side, indent) {
  const isPresent = (side === 'left') ? (node.status !== 'only_right') : (node.status !== 'only_left');

  if (!isPresent) {
    // Placeholder: file doesn't exist on this side
    return '<div class="file-row placeholder" style="padding-left:' + (12 + indent) + 'px">'
      + '<span class="name" style="color:var(--text2);font-style:italic">&mdash;</span>'
      + '<span class="size"></span>'
      + '<span class="indicator"></span>'
      + '</div>';
  }

  const info = (side === 'left') ? node.leftInfo : node.rightInfo;
  const sizeStr = info ? formatSize(info.size) : '';

  let indicatorColor, indicatorTitle;
  const isClickable = (node.status === 'modified' && info && info.is_text);
  const selClass = (activeDiffFile === node.path) ? ' selected' : '';

  switch (node.status) {
    case 'identical':
      indicatorColor = 'var(--green)'; indicatorTitle = 'Identical'; break;
    case 'modified':
      indicatorColor = 'var(--yellow)'; indicatorTitle = 'Modified' + (isClickable ? ' (click for diff)' : ' (binary)'); break;
    case 'only_left':
      indicatorColor = 'var(--red)'; indicatorTitle = 'Only in left'; break;
    case 'only_right':
      indicatorColor = 'var(--red)'; indicatorTitle = 'Only in right'; break;
    default:
      indicatorColor = 'var(--text2)'; indicatorTitle = '';
  }

  const clickAttr = isClickable
    ? ' style="padding-left:' + (12 + indent) + 'px;cursor:pointer" onclick="showDiff(\'' + escapeAttr(node.path) + '\')"'
    : ' style="padding-left:' + (12 + indent) + 'px"';

  return '<div class="file-row' + selClass + '"' + clickAttr + '>'
    + '<span class="name" title="' + escapeHtml(node.path) + '">' + highlightMatch(escapeHtml(node.name)) + '</span>'
    + '<span class="size">' + sizeStr + '</span>'
    + '<span class="indicator" title="' + indicatorTitle + '" style="color:' + indicatorColor + '">&#9679;</span>'
    + '</div>';
}

function highlightMatch(nameHtml) {
  if (!currentFilter) return nameHtml;
  const lower = nameHtml.toLowerCase();
  const q = currentFilter.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return nameHtml;
  return nameHtml.substring(0, idx)
    + '<span class="match-hl">' + nameHtml.substring(idx, idx + q.length) + '</span>'
    + nameHtml.substring(idx + q.length);
}

/* =========================================================
   Status bar
   ========================================================= */
function renderStatusBar() {
  if (!DATA) return;
  const sb = document.getElementById('status-bar');
  const du = DATA.disk_usage;
  sb.innerHTML =
    '<div class="counters">'
    + '<span style="color:var(--green)">' + DATA.identical.length + ' identical</span>'
    + '<span>|</span>'
    + '<span style="color:var(--yellow)">' + DATA.modified.length + ' modified</span>'
    + '<span>|</span>'
    + '<span style="color:var(--red)">' + DATA.only_left.length + ' only-left</span>'
    + '<span>|</span>'
    + '<span style="color:var(--red)">' + DATA.only_right.length + ' only-right</span>'
    + '</div>'
    + '<div class="disk">'
    + '<span>Left: ' + du.left.file_count.toLocaleString() + ' files, ' + formatSize(du.left.total_size) + '</span>'
    + '<span>|</span>'
    + '<span>Right: ' + du.right.file_count.toLocaleString() + ' files, ' + formatSize(du.right.total_size) + '</span>'
    + '</div>';
}

function renderHeaderCounters() {
  if (!DATA) return;
  const el = document.getElementById('header-counters');
  el.innerHTML =
    '<span class="header-counter"><span class="dot" style="background:var(--green)"></span><span class="cnt">' + DATA.identical.length + '</span> identical</span>'
    + '<span class="header-counter"><span class="dot" style="background:var(--yellow)"></span><span class="cnt">' + DATA.modified.length + '</span> modified</span>'
    + '<span class="header-counter"><span class="dot" style="background:var(--red)"></span><span class="cnt">' + DATA.only_left.length + '</span> only-left</span>'
    + '<span class="header-counter"><span class="dot" style="background:var(--red)"></span><span class="cnt">' + DATA.only_right.length + '</span> only-right</span>';
}

/* =========================================================
   Interactions
   ========================================================= */
function toggleDir(path) {
  if (expandedDirs.has(path)) expandedDirs.delete(path);
  else expandedDirs.add(path);
  renderPanels();
}

function applyFilter() {
  currentFilter = document.getElementById('search').value.trim();
  renderPanels();
}

/* Synchronized scroll */
function syncScroll(source) {
  const leftEl = document.getElementById('body-left');
  const rightEl = document.getElementById('body-right');
  const target = (source === leftEl) ? rightEl : leftEl;
  target.scrollTop = source.scrollTop;
}

/* =========================================================
   Diff panel
   ========================================================= */
async function showDiff(filePath) {
  activeDiffFile = filePath;
  const panel = document.getElementById('diff-panel');
  const resizer = document.getElementById('diff-resizer');
  const container = document.getElementById('diff-container');
  const title = document.getElementById('diff-title');

  title.textContent = filePath;
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading diff...</p></div>';

  // Open panel
  if (!diffPanelHeight) diffPanelHeight = Math.round(window.innerHeight * 0.35);
  panel.classList.add('open');
  panel.style.height = diffPanelHeight + 'px';
  resizer.classList.add('open');

  renderPanels();  // update selected state

  try {
    const resp = await fetch('/api/diff?file=' + encodeURIComponent(filePath));
    const data = await resp.json();
    renderDiff(data.lines);
  } catch(e) {
    container.innerHTML = '<div class="empty" style="color:var(--red)">Error loading diff</div>';
  }
}

function renderDiff(lines) {
  const container = document.getElementById('diff-container');
  if (!lines || lines.length === 0) {
    container.innerHTML = '<div class="empty">No differences (or binary file)</div>';
    return;
  }

  let h = '<table class="diff-table">';
  let leftNum = 0, rightNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\n$/, '');

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)/);
      if (match) leftNum = parseInt(match[1]) - 1;
      const match2 = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match2) rightNum = parseInt(match2[1]) - 1;
      h += '<tr class="diff-hunk"><td colspan="3">' + escapeHtml(line) + '</td></tr>';
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    } else if (line.startsWith('-')) {
      leftNum++;
      h += '<tr class="diff-del"><td class="diff-line-num">' + leftNum + '</td><td class="diff-line-num"></td><td>' + escapeHtml(line.substring(1)) + '</td></tr>';
    } else if (line.startsWith('+')) {
      rightNum++;
      h += '<tr class="diff-add"><td class="diff-line-num"></td><td class="diff-line-num">' + rightNum + '</td><td>' + escapeHtml(line.substring(1)) + '</td></tr>';
    } else if (line.startsWith(' ')) {
      leftNum++; rightNum++;
      h += '<tr><td class="diff-line-num">' + leftNum + '</td><td class="diff-line-num">' + rightNum + '</td><td>' + escapeHtml(line.substring(1)) + '</td></tr>';
    }
  }

  h += '</table>';
  container.innerHTML = h;
}

function closeDiff() {
  document.getElementById('diff-panel').classList.remove('open');
  document.getElementById('diff-resizer').classList.remove('open');
  activeDiffFile = null;
  renderPanels();
}

/* =========================================================
   Resizers
   ========================================================= */
function initResizer() {
  // Vertical panel divider
  const divider = document.getElementById('panel-divider');
  const wrapper = document.getElementById('panels-wrapper');
  let startX, startLeftW;

  divider.addEventListener('mousedown', function(e) {
    e.preventDefault();
    divider.classList.add('dragging');
    startX = e.clientX;
    const rect = wrapper.getBoundingClientRect();
    const leftPanel = document.getElementById('panel-left');
    startLeftW = leftPanel.getBoundingClientRect().width / rect.width;

    function onMove(e) {
      const dx = e.clientX - startX;
      const totalW = rect.width;
      let newFrac = startLeftW + dx / totalW;
      newFrac = Math.max(0.15, Math.min(0.85, newFrac));
      const rightFrac = 1 - newFrac;
      wrapper.style.gridTemplateColumns = newFrac + 'fr 4px ' + rightFrac + 'fr';
    }
    function onUp() {
      divider.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Diff panel resizer (horizontal)
  const diffResizer = document.getElementById('diff-resizer');
  diffResizer.addEventListener('mousedown', function(e) {
    e.preventDefault();
    diffResizer.classList.add('dragging');
    const startY = e.clientY;
    const startH = diffPanelHeight;

    function onMove(e) {
      const dy = startY - e.clientY;
      diffPanelHeight = Math.max(80, Math.min(window.innerHeight * 0.8, startH + dy));
      document.getElementById('diff-panel').style.height = diffPanelHeight + 'px';
    }
    function onUp() {
      diffResizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* =========================================================
   Load data & boot
   ========================================================= */
async function loadData() {
  try {
    const resp = await fetch('/api/scan');
    DATA = await resp.json();

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('path-left').textContent = DATA.left_root;
    document.getElementById('path-right').textContent = DATA.right_root;

    unifiedTree = buildUnifiedTree(DATA);
    autoExpandTree(unifiedTree);

    renderHeaderCounters();
    renderPanels();
    renderStatusBar();
  } catch(e) {
    document.getElementById('loading').innerHTML =
      '<p style="color:var(--red)">Error loading data: ' + escapeHtml(e.message) + '</p>';
  }
}

// Synchronized scroll setup
document.getElementById('body-left').addEventListener('scroll', function() { syncScroll(this); });
document.getElementById('body-right').addEventListener('scroll', function() { syncScroll(this); });

// Keyboard
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeDiff();
});

// Boot
initResizer();
loadData();
</script>
</body>
</html>"""


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class DiffHandler(BaseHTTPRequestHandler):
    left_root = ""
    right_root = ""
    _cached_results = None

    def log_message(self, fmt, *args):
        # quieter logging
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html_str, status=200):
        body = html_str.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == "/":
            self._send_html(HTML_PAGE)

        elif path == "/api/scan":
            if DiffHandler._cached_results is None:
                print("  Scanning directories...")
                t0 = time.time()
                DiffHandler._cached_results = compare_directories(
                    DiffHandler.left_root, DiffHandler.right_root
                )
                elapsed = time.time() - t0
                r = DiffHandler._cached_results
                print(f"  Scan complete in {elapsed:.1f}s — "
                      f"{len(r['identical'])} identical, "
                      f"{len(r['modified'])} modified, "
                      f"{len(r['only_left'])} only-left, "
                      f"{len(r['only_right'])} only-right")
            self._send_json(DiffHandler._cached_results)

        elif path == "/api/diff":
            rel_path = params.get("file", [""])[0]
            if not rel_path:
                self._send_json({"error": "missing file param"}, 400)
                return
            # Security: prevent path traversal
            normalized = os.path.normpath(rel_path)
            if normalized.startswith("..") or os.path.isabs(normalized):
                self._send_json({"error": "invalid path"}, 400)
                return
            lines = get_unified_diff(
                DiffHandler.left_root, DiffHandler.right_root, normalized
            )
            self._send_json({"file": normalized, "lines": lines})

        elif path == "/api/content":
            side = params.get("dir", [""])[0]
            rel_path = params.get("file", [""])[0]
            if side not in ("left", "right") or not rel_path:
                self._send_json({"error": "invalid params"}, 400)
                return
            normalized = os.path.normpath(rel_path)
            if normalized.startswith("..") or os.path.isabs(normalized):
                self._send_json({"error": "invalid path"}, 400)
                return
            root = DiffHandler.left_root if side == "left" else DiffHandler.right_root
            fpath = os.path.join(root, normalized)
            try:
                with open(fpath, "r", errors="replace") as f:
                    content = f.read(1_000_000)  # cap at 1 MB
                self._send_json({"file": normalized, "side": side, "content": content})
            except OSError as e:
                self._send_json({"error": str(e)}, 404)

        else:
            self.send_response(404)
            self.end_headers()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Compare two directories and browse results in a web UI."
    )
    parser.add_argument("left", help="First (left) directory")
    parser.add_argument("right", help="Second (right) directory")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port (default 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser automatically")
    args = parser.parse_args()

    # Validate directories
    for label, path in [("Left", args.left), ("Right", args.right)]:
        if not os.path.isdir(path):
            print(f"Error: {label} path is not a directory: {path}", file=sys.stderr)
            sys.exit(1)

    DiffHandler.left_root = os.path.realpath(args.left)
    DiffHandler.right_root = os.path.realpath(args.right)

    server = HTTPServer(("127.0.0.1", args.port), DiffHandler)
    url = f"http://127.0.0.1:{args.port}"

    print(f"DirDiff server running at {url}")
    print(f"  Left:  {DiffHandler.left_root}")
    print(f"  Right: {DiffHandler.right_root}")
    print("  Press Ctrl+C to stop.\n")

    if not args.no_browser:
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
