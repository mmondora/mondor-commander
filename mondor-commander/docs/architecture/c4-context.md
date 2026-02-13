# C4 Level 1 -- System Context Diagram

Shows Mondor Commander as a black box and its interactions with external actors and systems.

Mondor Commander is a **local CLI tool** -- it has no cloud dependencies, no database, and no network services beyond the localhost web server it starts for its own UI. The only external interactions are reading the local filesystem and serving a web UI to the user's browser.

```mermaid
C4Context
    title System Context — Mondor Commander

    Person(user, "Developer / User", "Invokes mc CLI to analyze directories")
    System(mc, "Mondor Commander", "CLI tool that scans, compares, and visualizes directory contents via a local web UI")
    System_Ext(fs, "Local Filesystem", "Directories to scan (read-only access)")
    System_Ext(browser, "Web Browser", "Displays the retro DOS interface")

    Rel(user, mc, "Runs CLI with directory paths")
    Rel(mc, fs, "Reads directory structure, file metadata, file content")
    Rel(mc, browser, "Auto-opens and serves web UI on localhost")
    Rel(browser, mc, "Fetches data via REST API + WebSocket")
```

## Key decisions reflected

- **No cloud or network dependency**: The tool is fully self-contained. The user provides local directory paths; the tool reads them and presents results locally.
- **Read-only filesystem access**: Mondor Commander never writes, modifies, or deletes files. This is a core safety guarantee.
- **Localhost-only server**: The web server binds to `127.0.0.1`, making it inaccessible from the network. No authentication is needed because only the local user can reach it.
