# ADR-003: Localhost-Only Server (No Authentication)

**Status**: Accepted
**Date**: 2026-02-13
**Deciders**: Project author

## Context

Mondor Commander starts an Express web server to serve its UI and API. This server provides read-only access to the scanned directories, including file content for text files. The server must be protected from unauthorized access.

Options considered:
1. **Bind to 127.0.0.1** (localhost only, no authentication)
2. **Bind to 0.0.0.0 with token-based authentication** (network accessible, require a session token)
3. **Bind to 0.0.0.0 with no authentication** (network accessible, open)

## Decision

Bind the server exclusively to `127.0.0.1`. No authentication mechanism. WebSocket connections validated for localhost origin.

## Rationale

- **Minimal attack surface**: By binding to localhost, the server is unreachable from the network. Only processes on the same machine can connect. This eliminates the need for authentication, TLS, or CORS configuration.
- **CLI tool convention**: This follows the same pattern as other local dev tools (Vite, webpack-dev-server, Storybook) that bind to localhost by default.
- **Simplicity**: No user accounts, no tokens, no login flow, no session management. The user who starts the CLI is the only user.
- **Defense in depth**: Even on localhost, WebSocket connections validate the `Origin` header to prevent cross-site WebSocket hijacking from malicious web pages.

## Consequences

### Positive
- Zero authentication code to write, test, and maintain
- No risk of leaked credentials or session tokens
- The server is invisible to other machines on the network

### Negative
- Cannot share a scan session with a colleague on a different machine
- Any local process can access the API (this is acceptable -- localhost trust is standard for CLI tools)
- If the user explicitly wants network access (e.g., running on a remote server), they must use SSH port forwarding

### Security controls in place
1. `server.listen(port, '127.0.0.1')` -- binds to loopback only
2. WebSocket `verifyClient` rejects non-localhost origins
3. Security headers on all responses (CSP, X-Frame-Options, X-Content-Type-Options)
4. Path traversal protection on `/file-content` (file must be within scan root)
5. `absolutePath` stripped from all API responses

### When to revisit
- If the tool adds a "share scan" feature for remote viewing
- If it is packaged as a web service (SaaS) rather than a CLI tool
