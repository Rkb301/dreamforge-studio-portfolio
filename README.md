# Dreamforge Studio ? Portfolio Source Snapshot

A local-first fictional worldbuilding studio with a browser interface and persistent storage. This is a curated snapshot of **implemented functionality only**, provided to demonstrate application engineering, UI design, storage correctness, and automated testing.

## Included functionality

- Create and edit worlds, character and place entries, relationships, and timeline records.
- Review author-controlled world-building drafts before saving them.
- Browse connected entries, search, and switch between interface palettes.
- Save through IndexedDB, protect against stale-tab overwrites, and export/import local backups.
- Generate procedural seed content off the main UI thread.
- Optionally connect to a locally installed model through a loopback-only integration; the core interface does not require a model or cloud API.

## Stack

JavaScript, TypeScript, Vite, IndexedDB, Vitest, Playwright, and an optional local model runtime.

## Run locally

Requires Node.js 22 or newer. From the repository root:

```bash
npm ci
npm run dev
```

The development server runs on `http://127.0.0.1:5173`. To build and run the production bundle:

```bash
npm run build
npm start
```

## Validation

```bash
npm run validate
```

The validation script checks formatting, linting, TypeScript types, unit tests, a production build, and browser end-to-end tests. Browser tests require the corresponding Playwright browser runtime; see `scripts/test-browser.mjs`.

## Data and privacy

This snapshot excludes development history, private authored worlds, personal backups, credentials, browser profiles, local model weights, private design documents, and unpublished planning materials. The application stores local browser data on the user's device; the repository contains no user's saved worlds. No public hosting or shared account is required for the core studio.

**Portfolio focus:** Frontend engineering ? TypeScript ? offline-first architecture ? persistent data ? responsive UX ? automated browser testing.
