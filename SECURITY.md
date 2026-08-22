# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public GitHub issue. The preferred channel is [GitHub Security Advisories](../../security/advisories/new) for this repository, which allows a private disclosure and discussion before any public issue is created.

Please include:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal repro is ideal)
- The Chrome version and OS you observed it on

## Scope

SignSync is a client-side Chrome extension with no backend server. Relevant categories of concern:

- **Extension permissions**: is `manifest.json`'s `permissions`/`host_permissions` broader than a feature actually needs?
- **Content Security Policy**: does any change weaken `extension_pages`'s `script-src`/`object-src`?
- **Data handling**: does any change cause camera frames, microphone audio, or personalized-gesture data to leave the device unexpectedly? (See `PRIVACY.md` for what's currently guaranteed.)
- **Message-passing**: does any `chrome.runtime`/`chrome.tabs` message handler trust unvalidated input from a web page's content script context in a way that could be abused by a malicious page?
- **Dependency vulnerabilities**: issues in `@mediapipe/tasks-vision`, `react`, or other declared dependencies.

## Our commitments

- No secrets, API keys, or credentials should ever be committed to this repository. If you find one, please report it privately — it will be rotated/removed immediately.
- This project has no backend and makes no network calls in its current implementation (verified by repository-wide search, not merely assumed) — any change that introduces one should be treated as a meaningful, reviewable change to the privacy model, not a routine addition.
- Permission requests (camera, microphone) are always tied to the specific feature that needs them and go through Chrome's normal user-facing permission prompts — see `PRIVACY.md`.
