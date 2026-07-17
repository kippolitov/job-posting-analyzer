# Security Policy

## Reporting a vulnerability

Please report security issues privately via [GitHub's private vulnerability
reporting](https://github.com/kippolitov/job-posting-analyzer/security/advisories/new)
— do not open a public issue for anything exploitable.

Reports are typically acknowledged within a few days. Please include steps to
reproduce and the impact you believe the issue has.

## Scope

- The Chrome extension (`extension/`) and its published Chrome Web Store build
- The Azure Functions backend (`functions/`) at `job-posting-analyzer-func.azurewebsites.net`
- The product site at `kippolitov.github.io/job-posting-analyzer`

Payment processing is handled by Paddle (merchant of record); card data never
touches this codebase or its infrastructure. Issues in Paddle's own checkout
should be reported to [Paddle](https://www.paddle.com/).

## Supported versions

Only the latest published Chrome Web Store version is supported — the
extension auto-updates, and the backend enforces auth, metering, and webhook
signatures server-side regardless of client version.
