# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
