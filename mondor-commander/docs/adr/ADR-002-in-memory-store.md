# ADR-002: In-Memory Store (No Database)

**Status**: Accepted
**Date**: 2026-02-13
**Deciders**: Project author

## Context

Mondor Commander scans directories and produces analysis results (file lists, comparisons, duplicates, space analysis). These results must be accessible to the REST API endpoints during the session.

Options considered:
1. **In-memory JavaScript object** (the `store` in `server/index.js`)
2. **SQLite database** for persistent storage
3. **JSON file on disk** for persistence across restarts

## Decision

Use a **plain JavaScript object** (`store`) held in memory for the lifetime of the server process. No database, no file persistence.

## Rationale

- **CLI tool lifecycle**: The user runs `mc /dir1 /dir2`, views results, then exits. There is no session to resume, no data to persist. Each run starts fresh.
- **Single-user, single-session**: Only one scan pipeline runs at a time. No concurrent writes, no transactions, no ACID requirements.
- **Performance**: In-memory access is O(1) for the store object. No serialization/deserialization overhead for API responses (objects are already in memory and JSON.stringify'd directly).
- **Zero dependencies**: No database driver, no ORM, no migration tool. Keeps the dependency tree minimal (5 production dependencies).

## Consequences

### Positive
- No database setup, no connection management, no migration workflow
- API response latency is minimal (direct object access + JSON serialization)
- The full analysis dataset (file entries, comparison indexes, treemap data) is available without any query language

### Negative
- Memory usage scales with directory size -- a 100K-file scan holds ~100K FileEntry objects in memory
- No persistence -- if the process crashes, all scan data is lost (the user must re-run)
- No query flexibility -- the API endpoint code manually filters/sorts arrays rather than using SQL

### When to revisit
- If the tool adds a "save scan" or "resume scan" feature
- If memory usage becomes a problem for very large directories (>500K files)
- If multiple concurrent scans need to coexist
