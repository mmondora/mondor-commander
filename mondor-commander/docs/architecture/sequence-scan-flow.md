# Sequence Diagram -- Scan-to-Ready Flow

Documents the full lifecycle from CLI invocation to the frontend becoming interactive. This is the primary runtime flow of Mondor Commander.

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI (cli.js)
    participant Server as Server (index.js)
    participant WS as WebSocket
    participant Browser
    participant Walker as Walker
    participant Hasher as Hasher
    participant Analyzer as Analyzer
    participant FS as Filesystem

    User->>CLI: mc /dir1 /dir2
    CLI->>CLI: Parse args, validate paths
    CLI->>Server: startServer(config)
    Server->>Server: Create Express app + HTTP server
    Server->>WS: attach(server)
    Server->>Server: Listen on 127.0.0.1:PORT

    Server->>Browser: Auto-open http://localhost:PORT
    Browser->>Server: GET /
    Server-->>Browser: index.html (frontend)
    Browser->>WS: Connect to ws://localhost:PORT/ws

    Note over Server: Background: runScan() starts

    rect rgb(240, 248, 255)
        Note over Walker,FS: Phase 1: Scan Left
        Server->>Walker: walk(dir1, 'left')
        loop Every 100 files
            Walker->>FS: readdir + stat
            Walker->>WS: scan:progress (left)
            WS-->>Browser: scan:progress
        end
        Walker-->>Server: ScanResult (left)
        WS-->>Browser: scan:complete (left)
    end

    rect rgb(240, 248, 255)
        Note over Hasher,FS: Phase 2: Hash Left
        Server->>Hasher: hashFiles(leftFiles)
        loop 10 concurrent workers
            Hasher->>FS: createReadStream (64KB chunks)
            Hasher->>Hasher: SHA-256 digest
        end
        Hasher-->>Server: Files with hashes
    end

    rect rgb(255, 248, 240)
        Note over Walker,FS: Phase 3: Scan Right
        Server->>Walker: walk(dir2, 'right')
        Walker->>FS: readdir + stat
        Walker-->>Server: ScanResult (right)
        WS-->>Browser: scan:complete (right)
    end

    rect rgb(255, 248, 240)
        Note over Hasher,FS: Phase 4: Hash Right
        Server->>Hasher: hashFiles(rightFiles)
        Hasher-->>Server: Files with hashes
    end

    rect rgb(240, 255, 240)
        Note over Analyzer: Phase 5: Analyze
        Server->>Analyzer: analyze(scanLeft, scanRight)
        Analyzer->>Analyzer: buildComparison (Map-based O(1))
        Analyzer->>Analyzer: findDuplicates (hash grouping)
        Analyzer->>Analyzer: buildSpaceAnalysis (extension + directory)
        Analyzer-->>Server: AnalysisResult
        WS-->>Browser: analysis:complete
    end

    Note over Browser: Status: ready — UI becomes interactive
    Browser->>Server: GET /api/browse?side=left
    Server-->>Browser: Directory entries with comparison status
```

## Key timing observations

- Phases 1-4 are **sequential** (left scan, left hash, right scan, right hash). This simplifies the code but means the total scan time is the sum of both directories.
- Phase 5 (analysis) is **CPU-bound, pure computation**. It runs synchronously on the main thread. For very large scans this could block the event loop briefly.
- The browser connects early (during scanning) and receives progress events in real-time via WebSocket. The UI shows a progress indicator until `analysis:complete` arrives.
- The `/api/*` endpoints return HTTP 202 while scanning/analyzing, and full data once `ready`.
