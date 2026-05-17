# Security Policy

## Security posture in one paragraph

Pandoras Box runs agents that act on your behalf -- send mail, place trades, post content. The system is designed so a single broken component cannot lose your data, leak your credentials, or take an irreversible action you did not approve. Every layer is enforced in code, not by policy: OS user isolation between tenants, credential scoping, content classification, independent oversight, automatic lockdown, and an encrypted offsite backup. Operator-specific identifying material never sits inside the source tree (see "Sanitization defense" below).

## Sanitization defense (three layers)

The project keeps operator-specific patterns (your real name, paths, tenant slugs, hostnames, emails) **out of the repo and out of git history** by design. The defense is layered so a single missed hook cannot leak.

| Layer | Location | When it fires | Bypassable? |
|---|---|---|---|
| 1 | `hooks/pre-commit` (local) | Every `git commit` | `--no-verify` bypasses, but then layer 2 catches |
| 2 | `hooks/pre-push` (local) | Every `git push` | `--no-verify` bypasses, but then layer 3 catches |
| 3 | `.github/workflows/sanitize.yml` | Every push and PR on GitHub | Not bypassable -- runs server-side |

Layers 1 and 2 read the operator-specific pattern list from `~/.config/pandoras-box/sanitize-patterns` -- a file that lives **only on the operator's machine** and is gitignored at the repo root. Layer 3 only checks generic credential shapes (Anthropic / AWS / GitHub / Google / Slack / B2 / etc.) so the workflow itself never exposes operator-specific patterns. All three layers refuse to run if `.sanitize-patterns` or `.sanitize-allowlist` is ever found at the repo root ("gate-on-the-gate").

To set up the local patterns file:

```bash
mkdir -p ~/.config/pandoras-box
cp hooks/sanitize-patterns.template ~/.config/pandoras-box/sanitize-patterns
chmod 600 ~/.config/pandoras-box/sanitize-patterns
# edit ~/.config/pandoras-box/sanitize-patterns to add your real names / paths / tenants
cp hooks/pre-commit  .git/hooks/pre-commit  && chmod +x .git/hooks/pre-commit
cp hooks/pre-push    .git/hooks/pre-push    && chmod +x .git/hooks/pre-push
```

## Reporting a Vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Open a [GitHub Security Advisory](https://github.com/AI-PandorasBox/pandoras-box/security/advisories/new)
instead. We will acknowledge receipt within 14 days (best effort) and work with you to understand
and address the issue.

## Scope

- Vulnerabilities in Pandoras Box source code are in scope.
- Do not test against live instances you do not own or have explicit permission to test.
- Social engineering attacks, physical access attacks, and denial of service are out of scope.

## No Bug Bounty

There is no paid bug bounty programme at this time. Responsible disclosures are credited in
release notes if desired.

## Supported Versions

Only the latest release is actively maintained. Please test against the latest release before
filing a report.
