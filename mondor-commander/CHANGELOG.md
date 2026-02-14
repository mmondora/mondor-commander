# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/mmondora/mondor-commander/compare/mondor-commander-v1.0.0...mondor-commander-v1.1.0) (2026-02-14)


### Features

* add directory diff indicators, synced panel navigation, and UI polish (M7.3) ([47995ac](https://github.com/mmondora/mondor-commander/commit/47995ac37f076dabb7e2ed2f943f1c49e7541c9b))
* add MCP server integration and LLM chat to GUI ([0dac3cf](https://github.com/mmondora/mondor-commander/commit/0dac3cf855e85fddd9638fe2f549092b4e3412c9))
* add Photo Intelligence with EXIF extraction, perceptual hashing, and visual duplicate detection (M7) ([da4e551](https://github.com/mmondora/mondor-commander/commit/da4e5516633a9d8a97e3abd07e7d3d255f218649))
* add photo KEEP/DELETE actions, batch cleanup, manual best override, and compare actions (M7.2) ([4cc8923](https://github.com/mmondora/mondor-commander/commit/4cc8923c7c1c6cdbc74a002bca15b2111087b7c4))
* add sync plan, script generation, and full diff viewer (M5.5) ([4567492](https://github.com/mmondora/mondor-commander/commit/4567492bbcc9f474013ab90278b6a74bc671cc57))
* add syntax highlighting, responsive layout, Safe Mode banner, and safety audit test (M6) ([4328163](https://github.com/mmondora/mondor-commander/commit/43281635448fe0699a4a5531ec06139622fa2506))
* always show full path in panel headers and add font zoom (Ctrl+/-/0) ([49d1e1c](https://github.com/mmondora/mondor-commander/commit/49d1e1cfa9294791a7636d70ab0343b8f9a9b001))
* enhance Photo Intelligence with sort controls, dashboard strip, EXIF viewer, and enriched data model (M7.1) ([a490956](https://github.com/mmondora/mondor-commander/commit/a4909560753d6177a5d8dcca1c76eacad7d97136))
* initial commit with full security hardening, tests, and docs ([21fb386](https://github.com/mmondora/mondor-commander/commit/21fb38622121cd732cfab190b93c5271d4652f07))
* replace 3-column Compare with unified Sync Planner + symlink loop detection ([d633122](https://github.com/mmondora/mondor-commander/commit/d633122c2dc6c62b59dd183c2336dbddb2ae9638))


### Bug Fixes

* resolve UI stuck on "Scanning" after scan completion ([4208cf4](https://github.com/mmondora/mondor-commander/commit/4208cf4fe6e3afae375e877ffbf57ebeaee90c9b))

## [Unreleased]

### Added
- Unit test suite with Vitest (44 tests covering analyzer, walker, CLI parsing)
- `.gitignore` file
- `LICENSE` file (MIT)
- This `CHANGELOG.md`
- Security headers (X-Content-Type-Options, X-Frame-Options, CSP)
- Path traversal protection on `/file-content` endpoint
- WebSocket origin validation (localhost only)
- Global Express error handler
- GitHub Actions CI pipeline

### Changed
- Server now binds to `127.0.0.1` instead of `0.0.0.0`
- CLI version reads from `package.json` instead of hardcoded value
- `/file-content` returns proper HTTP status codes (413, 415) instead of 200 with error body
- `getFileStatus()` uses pre-built Set indexes for O(1) lookups instead of O(n) Array.some()
- API responses no longer leak `absolutePath` filesystem information

### Removed
- `.env` from text extension allowlist (prevents serving secret files)

### Security
- **CRITICAL**: Server no longer exposed on all network interfaces
- **CRITICAL**: `.env` files can no longer be read via `/file-content`
- **HIGH**: Path traversal attack vector closed on `/file-content`
- **HIGH**: WebSocket connections restricted to localhost origin
- **MEDIUM**: `absolutePath` no longer leaked in API responses
- **MEDIUM**: Security headers added to all HTTP responses

## [1.0.0] - 2026-02-13

### Added
- Dual-pane Norton Commander-style file browser (F1)
- File content viewer with diff for modified files (F3)
- Three-column directory comparison (F5)
- Treemap visualization of disk space usage (F6)
- Duplicate file detection grouped by SHA-256 hash (F7)
- CLI options: `--port`, `--no-open`, `--max-depth`, `--max-file-size`, `--exclude`, `--no-hash`, `--follow-symlinks`, `--verbose`
- WebSocket-based real-time scan progress
- Express-based local web server with retro DOS UI
