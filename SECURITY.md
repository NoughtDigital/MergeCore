# Security policy

We take the security of MergeCore — the VS Code/Cursor extension, the review
pipeline, and the website — seriously. This document describes how to report
vulnerabilities and what we consider in-scope.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

- Email: `security@mergecore.dev`
- Alternative: open a private [Security Advisory](https://github.com/) on the
  relevant repository.
- Response SLA: we aim to acknowledge within 3 business days and to issue a
  fix or mitigation for confirmed vulnerabilities within 30 days.

When reporting, please include:

- A minimal reproduction (code, URL, extension version, host editor).
- The impact you believe it has (confidentiality, integrity, availability).
- Any proof-of-concept payload or logs that helped you find it.

We will credit reporters in release notes by default unless you prefer to
remain anonymous.

## Scope

In-scope:

- The `mergecore` VS Code/Cursor extension (this repo, `extension/`).
- The review pipeline code shipped here (`engine/`).
- The MergeCore marketing and docs site (`website/`).
- The MergeCore review API endpoints exposed at `https://api.mergecore.dev`.

Out of scope:

- Denial-of-service attempts against the public API.
- Findings that require a compromised developer workstation (e.g. a user
  deliberately pasting their own credentials into an upload).
- Vulnerabilities in third-party dependencies already tracked publicly; please
  prefer upstream reports and link us to the advisory.

## Client-side protections worth knowing about

- The bearer token for the MergeCore API is stored in the OS keychain via VS
  Code's `SecretStorage`. It is **never** written to `settings.json`. If you
  had previously set `mergecore.apiToken` in settings, the extension will
  migrate it to the keychain on first launch and clear the setting.
- The extension refuses to contact a non-`https` API base URL unless you
  explicitly enable `mergecore.allowInsecureLocalApi` and point at a localhost
  host — this is for local development only.
- The first time you send code to a new origin (after changing
  `mergecore.apiBaseUrl`) you will see a modal asking you to approve that
  origin. This defends against a hostile workspace overriding the URL via
  `.vscode/settings.json` or Settings Sync.
- Before upload we run a best-effort secret scan on the code and diff being
  reviewed. If we find something that looks like a credential we show a
  modal; you can either let us redact it in place (`<REDACTED:rule-id>`) or
  abort. This is a belt-and-braces check on top of server-side scrubbing.
- "Apply improved code" and "Apply patch" always show a native diff preview
  and require a second confirmation before overwriting your file.
- Every review request has a hard client-side timeout (default 60 s) and is
  bound to a `CancellationToken` so the UI "Cancel" button actually aborts
  the in-flight HTTP call.

## Cryptography

- Webview CSP nonces are generated with `crypto.randomBytes`, never
  `Math.random`.
- Cache keys on the server SHA-256 the ruleset version + deterministic
  findings + input. Secrets are never included in the key material.

## Responsible disclosure

Please give us reasonable time to fix the issue before any public disclosure.
We will coordinate with you on a release date and credit.
