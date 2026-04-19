# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.3.x   | ✅ Yes     |
| < 1.3   | ❌ No      |

---

## Reporting a Vulnerability

If you discover a security vulnerability in InboxZero AI, **please do not open a public GitHub issue.**

Instead, report it privately by emailing the maintainers directly. Include:

- A clear description of the vulnerability
- Steps to reproduce it
- Potential impact
- Any suggested fix (optional)

You can expect an acknowledgement within **48 hours** and a resolution or update within **7 days** depending on severity.

---

## Security Design

InboxZero AI is built with the following security principles:

- **No backend server** — all processing happens client-side inside the browser
- **No email persistence** — email content is never stored, logged, or transmitted beyond the AI API call
- **API key storage** — your Gemini API key is stored locally via `chrome.storage.sync` and never hardcoded or exposed
- **OAuth 2.0** — Gmail access is granted via Google's OAuth flow; no passwords are handled by the extension
- **Minimal permissions** — the extension only requests the Gmail scopes it strictly needs (`readonly`, `modify`, `labels`) and operates solely on `mail.google.com`
- **No third-party tracking** — no analytics, telemetry, or external dashboards

---

## Scope

This policy covers the InboxZero AI Chrome extension source code in this repository. It does not cover:

- The Gemini API (Google's responsibility)
- The Gmail API (Google's responsibility)
- Vulnerabilities in the user's browser or OS
