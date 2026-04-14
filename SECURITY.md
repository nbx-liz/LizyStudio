# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, use one of the following methods:

1. **GitHub Security Advisory (preferred):**
   Go to [Security → Advisories → New draft](https://github.com/nbx-liz/LizyStudio/security/advisories/new)
   and create a private advisory.

2. **Email:**
   Contact the maintainer directly. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response timeline

- **Acknowledgement:** within 3 business days
- **Initial assessment:** within 7 business days
- **Fix and release:** best-effort, typically within 14 days for critical issues

## Security design

LizyStudio is designed as a **single-user, local-first** application:

- Runs on `localhost` — not intended for public network exposure
- No authentication or multi-user session management
- Content Security Policy (CSP) headers are enforced
- DataFrame memory limits prevent excessive resource consumption
- File access is restricted to CSV, Parquet, and TSV formats
- All user input is validated through Pydantic models

### Known limitations

- LizyStudio does not implement authentication. Do not expose the server to
  untrusted networks.
- Uploaded files are processed in-memory. Large files may cause high memory usage.
- The `GET /api/files` endpoint lists local filesystem directories. This is
  intentional for the local-use model but would be a risk in a shared environment.

## Dependency management

- Python dependencies are pinned via `uv.lock`
- Frontend dependencies are pinned via `pnpm-lock.yaml`
- [Dependabot](.github/dependabot.yml) monitors for known vulnerabilities
