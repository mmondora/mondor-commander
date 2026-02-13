# ADR-001: Single HTML File Frontend

**Status**: Accepted
**Date**: 2026-02-13
**Deciders**: Project author

## Context

Mondor Commander needs a web-based UI to display scan results, directory browsing, file diffs, treemaps, and duplicate detection. The UI must be served by the Express server to the user's browser.

Options considered:
1. **Single HTML file** with inline CSS and vanilla JS
2. **React/Vue/Svelte SPA** with a bundler (Vite, webpack)
3. **Server-side rendered templates** (EJS, Pug)

## Decision

Use a **single HTML file** (`src/frontend/index.html`) containing all HTML, CSS, and JavaScript inline. No framework, no bundler, no build step.

## Rationale

- **Zero build complexity**: No bundler configuration, no transpilation, no source maps. `node bin/mc.js` just works.
- **Trivial serving**: Express reads one file and sends it. No static file middleware, no asset pipeline.
- **npm package simplicity**: The `files` field in package.json includes `src/` and the entire frontend ships as a single file. No `dist/` directory to manage.
- **Retro aesthetic match**: The Norton Commander DOS theme is achieved with a few hundred lines of CSS. A framework would add 100KB+ of runtime for no benefit.
- **No client-side routing needed**: The UI uses F-key views that swap DOM visibility, not URL routes.

## Consequences

### Positive
- Installation is `npm install -g` -- no post-install build step
- The frontend is ~1,750 lines, which is manageable in a single file
- No frontend dependency supply chain risk (no React, no npm packages in the browser)

### Negative
- No component reuse or module system -- code organization relies on functions and DOM IDs
- No hot module replacement during development -- manual browser refresh required
- 16 `innerHTML` assignments create a potential XSS surface (mitigated by the `esc()` escape function)
- If the UI grows significantly beyond ~3,000 lines, the single-file approach will become unwieldy

### When to revisit
- If the frontend exceeds ~3,000 lines or needs complex client-side state management
- If the project adds user-editable content (forms, settings) that would benefit from two-way data binding
