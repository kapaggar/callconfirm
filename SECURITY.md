# Security Policy

## Overview

This is a personal PWA for tracking Vipassana course attendance calls. It runs entirely in the browser no backend, no database, no server-side code.

## Data Handling

- **All data stays on your device.** Applicant names, phone numbers, and call status are stored in the browser's IndexedDB. Nothing is sent to any server.
- **The DIPI bookmarklet** runs in the context of your authenticated DIPI session. It reads data from the page you're viewing and passes it to the tracker via URL hash or clipboard. No credentials are transmitted or stored.
- **GitHub Pages** only serves static files (HTML, JS, CSS). It has no access to your data.

## Reporting a Vulnerability

If you find a security issue, email [kapaggar@gmail.com](mailto:kapaggar@gmail.com).

## Scope

This tool is designed for personal use by a single operator. It is not intended for multi-user deployment or to handle regulated data.
