# Mondor Commander

Norton Commander-style directory analyzer and comparator. Serves a retro DOS web interface for browsing, comparing, and analyzing directories.

```
┌─────────────────────────────┬─────────────────────────────┐
│  /home/user/project-a       │  /home/user/project-b       │
│  ─────────────────────────  │  ─────────────────────────  │
│  src/                  <DIR> │  src/                  <DIR> │
│  README.md            2.4KB │  README.md            2.1KB │
│  package.json         1.1KB │  package.json         1.1KB │
│  index.js             4.5KB │  index.js             8.2KB │
├─────────────────────────────┴─────────────────────────────┤
│ F1 Browse  F3 View  F5 Compare  F6 Space  F7 Dupes  F10 Q│
└───────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** >= 18
- **npm**

## Quick Start

```bash
git clone <repo-url>
cd mondor-commander/mondor-commander
npm ci
node bin/mc.js /path/to/dir1 /path/to/dir2
```

The browser opens automatically at `http://localhost:8333`.

## Usage

```bash
# Compare two directories
node bin/mc.js /path/to/dir1 /path/to/dir2

# Analyze a single directory
node bin/mc.js /path/to/dir

# Custom port, no auto-open
node bin/mc.js /path/to/dir1 /path/to/dir2 --port 9000 --no-open

# Fast scan (skip SHA-256 hashing)
node bin/mc.js /path/to/dir --no-hash
```

## Options

```
-p, --port <number>      Server port (default: 8333)
--no-open                Don't auto-open browser
--max-depth <number>     Max recursion depth (default: unlimited)
--max-file-size <size>   Skip hashing files larger than this (default: "1GB")
--exclude <patterns...>  Glob patterns to exclude (default: node_modules, .git, .DS_Store)
--no-hash                Skip SHA-256 hashing (faster, no duplicate detection)
--follow-symlinks        Follow symbolic links (default: false)
-v, --verbose            Verbose logging
```

## Views

| Key | View | Description |
|-----|------|-------------|
| F1  | Browse | Dual-pane Norton Commander file browser |
| F3  | View | File content viewer with diff for modified files |
| F5  | Compare | Three-column comparison (only-left / modified / only-right) |
| F6  | Space | Treemap visualization of disk space usage |
| F7  | Dupes | Duplicate file detection grouped by hash |
| F10 | Quit | Exit Mondor Commander |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Tab | Switch panel focus |
| Up/Down | Navigate files |
| Enter | Open directory / view file |
| Backspace | Go to parent directory |
| / | Quick search filter |
| Escape | Close overlay / return to browse |
| q | Quit |

## Color Coding (dual mode)

- **Green**: identical in both directories
- **Red**: only in this directory
- **Yellow**: modified (different hash)
- **Blue/White**: directories

## Architecture

```
CLI (commander.js)
 └─> Scanner
 │    ├─ Walker     — recursive directory traversal (EventEmitter)
 │    ├─ Hasher     — streaming SHA-256, 10-worker concurrency pool
 │    └─ Analyzer   — comparison, duplicates, space analysis (pure functions)
 └─> Server
      ├─ Express    — REST API (9 endpoints) on localhost:PORT
      ├─ WebSocket  — real-time scan progress broadcasts
      └─ Frontend   — single-file HTML/CSS/JS served at /
```

### REST API

Base URL: `http://localhost:8333/api`

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Scan status and progress |
| `GET /api/scan/left` | Left directory scan summary |
| `GET /api/scan/right` | Right directory scan summary |
| `GET /api/compare` | Full comparison results |
| `GET /api/space/left` | Left space analysis (by extension, directory, treemap) |
| `GET /api/space/right` | Right space analysis |
| `GET /api/duplicates` | Duplicate file groups |
| `GET /api/browse` | Directory listing with comparison status |
| `GET /api/file-content` | File content for text files (max 1MB) |

## Project Structure

```
mondor-commander/
├── bin/mc.js                  # CLI entry point
├── src/
│   ├── cli.js                 # Argument parsing and validation
│   ├── scanner/
│   │   ├── walker.js          # Directory traversal
│   │   ├── hasher.js          # SHA-256 file hashing
│   │   └── analyzer.js        # Comparison and analysis engine
│   ├── server/
│   │   ├── index.js           # Express server setup and scan orchestration
│   │   ├── api.js             # REST API routes
│   │   └── websocket.js       # WebSocket broadcaster
│   └── frontend/
│       └── index.html         # Single-file web frontend
├── tests/                     # Vitest unit tests
├── package.json
├── CHANGELOG.md
└── LICENSE
```

## Commands

| Command | Description |
|---------|-------------|
| `npm start -- <path1> [path2]` | Start Mondor Commander |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |

## Security

- Server listens on `127.0.0.1` only (not accessible from the network)
- Read-only filesystem access (no writes, no deletes)
- WebSocket connections restricted to localhost origin
- Path traversal protection on file content endpoint
- Security headers on all responses (CSP, X-Frame-Options, X-Content-Type-Options)

## License

[MIT](LICENSE)
