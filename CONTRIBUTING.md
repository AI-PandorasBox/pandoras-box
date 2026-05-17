# Contributing to Pandoras Box

Thank you for your interest in contributing. This document covers bug reports, pull requests, and module contributions.

---

## Reporting Bugs

Open a GitHub Issue with the following information:

- macOS version (`sw_vers`)
- Node.js version (`node --version`)
- Module versions (list which modules are installed)
- A sanitized log excerpt — remove any personal data, company names, API keys, or email content before posting
- Steps to reproduce
- Expected vs actual behaviour

**Security vulnerabilities:** do not use public Issues. See [SECURITY.md](SECURITY.md).

---

<!-- _A1_COVER_PAGE_V1 -- CLA section inserted before the PR submission steps -->

## Contributor License Agreement (CLA)

Before your first pull request can be merged, you must sign the project's Contributor License Agreement. The CLA grants the project a perpetual, worldwide, non-exclusive licence to use your contribution under the project's Apache 2.0 licence, and confirms you have the right to make the contribution.

The CLA is checked automatically by a GitHub bot when you open your first PR. You'll see a prompt to sign — it takes under a minute. Subsequent PRs from the same account are automatically covered.

**Why this exists.** The project's IP framework is documented in [IP-OWNERSHIP.md](IP-OWNERSHIP.md). The CLA protects both the project and contributors by making the licensing chain explicit: the project can confidently distribute your contribution under Apache 2.0, and you keep ownership of the underlying copyright in your work.

**If you object to the CLA**, please open a discussion before submitting a PR rather than opening the PR. We're happy to talk through alternative arrangements, but contributions cannot be merged without a signed CLA or equivalent.

---


## Branch model -- dev / testing / live

The repo uses three long-lived branches plus short-lived feature branches:

| Branch | Purpose | Promotion rule |
|---|---|---|
| `dev` | Active development. Frequent push, may be broken. | Default branch for short-lived feature branches to target via PR. |
| `testing` | Release candidate. Stable enough for end-to-end smoke. CI must be green. | Auto-promoted from `dev` by maintainers when a coherent set of changes is ready for a wider audience. |
| `main` (live) | What `bash install.sh` actually serves. Only proven, tested code reaches this branch. | Hand-promoted from `testing` after the release-candidate burn-in window (typically 7 days of dogfood, no Sev-1 issues). |

Workflow for a contributor:

```bash
# 1. Fork + branch off dev (NOT main)
git checkout dev && git pull origin dev
git checkout -b feat/your-feature-name

# 2. One-time local setup of the sanitize gate (see SECURITY.md)
mkdir -p ~/.config/pandoras-box
cp hooks/sanitize-patterns.template ~/.config/pandoras-box/sanitize-patterns
chmod 600 ~/.config/pandoras-box/sanitize-patterns
# Edit the file to add your real names / paths / tenants
cp hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
cp hooks/pre-push   .git/hooks/pre-push   && chmod +x .git/hooks/pre-push

# 3. Work normally. Pre-commit + pre-push both gate locally.
git commit -m "..."   # pre-commit fires
git push              # pre-push fires

# 4. Open a PR against `dev`.  CI runs the third sanitize layer + smoke tests.
```

**Direct PRs to `main` are not accepted.** Maintainers handle the
`dev -> testing -> main` promotion path. This is the staging discipline
that lets the install URL stay rock-stable.

### Maintainer promotion checklist (dev -> testing)

- [ ] All CI checks green on `dev`
- [ ] Installer dry-run smoke (PBOX_DRY_RUN=1) passes on macOS-14 runner
- [ ] No new operator-specific patterns introduced (check via the local
      sanitize hook, not just CI -- CI only catches generic shapes)
- [ ] CHANGELOG.md updated with the promotion
- [ ] Open a PR `dev -> testing`, merge after one reviewer approves

### Maintainer promotion checklist (testing -> main / live)

- [ ] `testing` has had 7+ days of dogfood by at least the maintainer
- [ ] No Sev-1 issues reported during burn-in
- [ ] Manual end-to-end install run on a clean Mac (not dry-run -- real)
- [ ] Manual end-to-end install run on a Mac that already has the previous
      release installed (re-install / upgrade path)
- [ ] Open a PR `testing -> main`, tag a release after merge

---

## One-off Pull Request quickstart

Recommended branch names:
- `feat/your-feature-name` for new features
- `fix/description-of-fix` for bug fixes
- `docs/description` for documentation changes

1. Fork the repository and branch off `dev` (see "Branch model" above).
2. Make your changes. Test locally before opening a PR.
3. Install the sanitize hooks (one-time, see above).
4. Open a PR against `dev`. Describe what you changed and why.

---

## Code Style

- No em dashes in comments or documentation. Use a regular hyphen or restructure the sentence.
- No AI clichés in user-facing strings ("Certainly!", "Great question!", "I'd be happy to").
- Comments only where the WHY is non-obvious — a hidden constraint, a subtle invariant, a specific workaround. Do not comment what the code does.
- Follow existing patterns in the file you are editing. Consistency over personal preference.

---

## Contributing a New Module

New modules go in `modules/new-module-name/` and follow this layout:

```
modules/new-module-name/
  install.sh                                  -- idempotent install script
  README.md                                   -- description / prerequisites / cost / uninstall
  requirements.md                             -- full prereqs, permissions, API scopes
  runtime/                                    -- the module's actual runtime
    <name>.mjs / <name>.py / ...              -- the program(s) the LaunchDaemon will run
    com.pandoras-box.<name>.plist.template    -- LaunchDaemon manifest template
```

### The runtime/ pattern (since v0.3.0)

Each module's runtime code lives **in the module's own `runtime/` subdirectory**, not in `lib/` or `scripts/` or at the repo root. The `install.sh` copies the runtime + the plist template into `$INSTALL_PATH/<name>/`, fills the template from `theme.conf`, validates with `plutil -lint`, and registers the LaunchDaemon.

Worked example: `modules/docs-server/`. See `runtime/pbox-docs-server.mjs` (the clean dependency-free HTTP server) + `runtime/com.pandoras-box.docs-server.plist.template` + `install.sh` (template substitution + plutil validation + curl-verify after load).

### Plist template placeholders

| Placeholder | Source | Example |
|---|---|---|
| `{{LAUNCHDAEMON_PREFIX}}` | `theme.conf` | `com.pandoras-box` |
| `{{INSTALL_PATH}}` | `theme.conf` | `/opt/pandoras-box` |
| `{{LOG_PREFIX}}` | `theme.conf` | `pandoras-box` |
| `{{NODE_BIN}}` | `command -v node` (or `$PBOX_NODE_BIN`) | `/opt/homebrew/bin/node` |
| `{{USER_NAME}}` | per-module convention (dedicated service account or single-tenant owner) | `docs-server` |

### Required install-script verification

Beyond writing files and registering the LaunchDaemon, every module's `install.sh` MUST:

- Run `plutil -lint` on the rendered plist BEFORE installing it (catches malformed XML before launchctl rejects it).
- Curl the configured port after `launchctl load` and report the HTTP code. A LaunchDaemon registered with a broken `ProgramArguments` will appear in `launchctl list` but fail to bind -- the curl is what catches that.
- Print `[<module>] PASS` or `[<module>] FAIL: <reason>` at exit.

### install.sh requirements

Every install script must:

- Be idempotent — running it twice must produce the same result as running it once
- Check prerequisites before starting (required modules, available commands, network access)
- Use theme variables from `/opt/pandoras-box/theme.conf` for any user-configurable values
- Print progress: `[module-name] step N/M: description`
- On failure: print a plain-English explanation of what failed and how to fix it manually
- At completion: print `[module-name] PASS` or `[module-name] FAIL: reason`

### Module documentation requirements

`README.md` must cover:

- What the module does (2-3 sentences)
- Prerequisites (hardware, software, API keys, other modules)
- API cost implications (estimate per-month at typical usage)
- Installation steps (what install.sh does; any steps requiring manual action)
- How to verify the installation worked
- How to uninstall (manual steps if install.sh does not include an uninstall path)

---

## Questions

Open a GitHub Discussion for questions about the codebase, architecture, or planned features.
