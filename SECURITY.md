# Security Policy

## Overview

Personal browser tooling for DIPI course admin (call tracker, course audit, photo
review). It runs entirely in the browser: no backend, no server-side database.

## Data Handling

- **All applicant data stays on your device.** Names, phones, call status, photo
  corrections, and face descriptors live in IndexedDB / localStorage on the
  `dipi.vridhamma.org` origin. Nothing is uploaded to GitHub Pages or any
  third-party analytics host.
- **The bookmarklet, Tampermonkey shells, and Chrome extension** run in the
  context of your authenticated DIPI session. They read the applicants page
  you already have open. Session hand-off between machines is an explicit
  JSON backup export/import (treat those files like CSV exports), not a URL hash.
- **GitHub Pages** only serves static files (HTML, JS, CSS, vendored WASM). It
  has no access to your data.
- **Exceptions that leave the browser** are explicit user actions: `tel:` and
  WhatsApp deep links, CSV/JSON/PDF exports, personalized letter fetch from
  `applicant.vridhamma.org/l.php?a=` (allow-listed), and photo write-back to
  dipi's own `/app/{aid}/edit` form.
- **Face descriptors** (`vcall_faces`) are biometric-adjacent and must never
  be exported. Matches are leads, not proof.

## Reporting a Vulnerability

If you find a security issue, email [kapaggar@gmail.com](mailto:kapaggar@gmail.com).

## Scope

This tool is designed for personal use by a single operator (or a small
centre team sharing backups). It is not intended for multi-user deployment.
